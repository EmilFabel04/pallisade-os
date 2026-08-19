# Fathom Meeting Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `fathom` capability group from a name returning `[]` into two working tools that let an agent search past meeting summaries and read one meeting in full.

**Architecture:** A server-only `fetch` client against `https://api.fathom.ai/external/v1`, a resolver that pages the list endpoint and filters in memory, and a capability grant gated on `FATHOM_API_KEY` being set so the group grants nothing rather than two tools that answer every call with "not connected". No local table, no cron, no new dependencies.

**Tech Stack:** Next.js 15 App Router (route handlers, `runtime = "nodejs"`), TypeScript strict, Vitest (`environment: "node"`, no DOM), global `fetch`.

**Spec:** `docs/superpowers/specs/2026-08-19-fathom-tools-design.md`

## Global Constraints

- **This branch stacks on `feat/projects-chat-migration` (PR #8).** It extends `AgentContext`, `capabilities.ts` and the anti-blindness test, none of which exist on `main`. Do not rebase onto `main`.
- **No test may make a network call.** Stub `fetch` (or the client module) at the boundary. A test that reaches `api.fathom.ai` is a defect regardless of whether it passes.
- **No test may touch `data/pallisade.db`.** `getClient()` (`src/lib/db/client.ts:16`) defaults to it and it holds real founder data: leads 11, quotes 3, projects 5, milestones 7.
- **No new runtime dependencies.** Fathom ships TypeScript and Python SDKs; use plain `fetch`. The app deliberately carries 11.
- **Wire field names are exact and non-negotiable** — copy them verbatim from the spec's "Wire field names" section. `recording_id` not `id`; `default_summary.markdown_formatted` not `.markdown`; `speaker` is an object with `display_name`, not a string. Guessing any of these produces code that compiles, passes its own fixtures, and returns nothing against the real API.
- **Never send `destination_url`** on the transcript request — it switches the endpoint to an async callback that returns no transcript.
- Tests are colocated `src/**/*.test.ts`, `environment: "node"`. `vitest.config.ts` excludes `.test.tsx`.
- **Run the mutant.** Every assertion added must be checked by breaking the thing it claims to detect. A green suite is the least reliable signal in this repo: the two documented failure modes are an assertion that passes against the thing it is meant to detect, and a capability granted but not wired.
- Verification: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

### Task 1: The Fathom HTTP client

**Files:**
- Create: `src/lib/fathom/config.ts`
- Create: `src/lib/fathom/client.ts`
- Test: `src/lib/fathom/client.test.ts`

**Interfaces:**
- Consumes: global `fetch`, `process.env.FATHOM_API_KEY`.
- Produces: `isConfigured(): boolean`; `listMeetings(params): Promise<{ items: FathomMeeting[]; nextCursor: string | null }>`; `getTranscript(recordingId): Promise<FathomTranscriptLine[]>`; the exported types `FathomMeeting`, `FathomTranscriptLine`; error classes `FathomAuthError`, `FathomRateLimitError`, `FathomError`. Task 2 depends on all of it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fathom/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listMeetings, getTranscript, isConfigured,
  FathomAuthError, FathomRateLimitError, FathomError,
} from "./client";
import { isConfigured as configured } from "./config";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.FATHOM_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FATHOM_API_KEY;
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe("isConfigured", () => {
  it("is true only when FATHOM_API_KEY is set", () => {
    expect(configured()).toBe(true);
    delete process.env.FATHOM_API_KEY;
    expect(configured()).toBe(false);
  });
});

describe("listMeetings", () => {
  it("calls the documented URL with the API key header", async () => {
    fetchMock.mockResolvedValue(ok({ items: [], next_cursor: null }));
    await listMeetings({ createdAfter: "2026-05-21T00:00:00.000Z" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.fathom.ai/external/v1/meetings");
    expect(String(url)).toContain("created_after=2026-05-21T00%3A00%3A00.000Z");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
  });

  it("passes a cursor through and returns the next one", async () => {
    fetchMock.mockResolvedValue(ok({ items: [], next_cursor: "cur-2" }));
    const page = await listMeetings({ cursor: "cur-1" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=cur-1");
    expect(page.nextCursor).toBe("cur-2");
  });

  it("returns null for nextCursor when the API omits it", async () => {
    fetchMock.mockResolvedValue(ok({ items: [] }));
    expect((await listMeetings({})).nextCursor).toBeNull();
  });

  it("returns the items array untouched", async () => {
    fetchMock.mockResolvedValue(ok({ items: [{ recording_id: "rec-1" }], next_cursor: null }));
    const page = await listMeetings({});
    expect(page.items[0].recording_id).toBe("rec-1");
  });

  it("throws FathomAuthError on 401", async () => {
    fetchMock.mockResolvedValue(fail(401));
    await expect(listMeetings({})).rejects.toBeInstanceOf(FathomAuthError);
  });

  it("throws FathomRateLimitError on 429", async () => {
    fetchMock.mockResolvedValue(fail(429));
    await expect(listMeetings({})).rejects.toBeInstanceOf(FathomRateLimitError);
  });

  it("throws FathomError carrying the status on any other non-2xx", async () => {
    fetchMock.mockResolvedValue(fail(503));
    await expect(listMeetings({})).rejects.toMatchObject({ status: 503 });
  });

  it("throws rather than calling fetch when no key is set", async () => {
    delete process.env.FATHOM_API_KEY;
    await expect(listMeetings({})).rejects.toThrow(/FATHOM_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTranscript", () => {
  // speaker is an OBJECT with display_name, not a string. The fixture omits any
  // string-shaped speaker so code that treats it as one yields undefined here.
  it("unwraps the transcript array from the response envelope", async () => {
    fetchMock.mockResolvedValue(ok({
      transcript: [
        { speaker: { display_name: "Emil", matched_calendar_invitee_email: null },
          text: "Let's talk pricing", timestamp: "00:01:12" },
      ],
    }));
    const lines = await getTranscript("rec-1");
    expect(lines).toHaveLength(1);
    expect(lines[0].speaker?.display_name).toBe("Emil");
    expect(lines[0].text).toBe("Let's talk pricing");
  });

  it("requests the documented recordings path", async () => {
    fetchMock.mockResolvedValue(ok({ transcript: [] }));
    await getTranscript("rec-9");
    expect(String(fetchMock.mock.calls[0][0]))
      .toContain("https://api.fathom.ai/external/v1/recordings/rec-9/transcript");
  });

  // destination_url switches the endpoint to an async callback that returns no
  // transcript at all. Sending it would look like an empty meeting.
  it("never sends destination_url", async () => {
    fetchMock.mockResolvedValue(ok({ transcript: [] }));
    await getTranscript("rec-9");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("destination_url");
  });

  it("returns an empty array when the envelope has no transcript", async () => {
    fetchMock.mockResolvedValue(ok({}));
    expect(await getTranscript("rec-1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fathom/client.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `config.ts`**

```ts
/** Fathom is configured when an API key is present. The single-user app uses a
 *  key rather than OAuth: OAuth exists for public integrations, and there is no
 *  second user to authorise. */
export function isConfigured(): boolean {
  return !!process.env.FATHOM_API_KEY?.trim();
}

/** The key, or a throw. Callers guard with isConfigured() first — the tool
 *  resolver turns the guard into prose the model can relay. */
export function apiKey(): string {
  const key = process.env.FATHOM_API_KEY?.trim();
  if (!key) throw new Error("FATHOM_API_KEY is not set");
  return key;
}
```

- [ ] **Step 4: Write `client.ts`**

```ts
/* ============================================================
   Fathom public API client (server-only).

   https://api.fathom.ai/external/v1, X-Api-Key auth. Reads process.env, so it
   must never be imported from a client component.

   Field names here are taken from the API reference verbatim, not inferred.
   `recording_id` is not `id`; `default_summary.markdown_formatted` is not
   `.markdown`; `speaker` is an object, not a string. Every field is optional:
   the API may add fields, and may omit ones this code does not require.
   ============================================================ */

import { apiKey, isConfigured } from "./config";

export { isConfigured };

const BASE = "https://api.fathom.ai/external/v1";

/** A hanging request inside an 8-iteration agent loop stalls the whole turn. */
const TIMEOUT_MS = 10000;

export class FathomAuthError extends Error {
  constructor() { super("Fathom rejected the API key"); }
}
export class FathomRateLimitError extends Error {
  constructor() { super("Fathom rate limit exceeded"); }
}
export class FathomError extends Error {
  constructor(readonly status: number) { super(`Fathom returned ${status}`); }
}

export interface FathomInvitee {
  name?: string;
  email?: string;
  email_domain?: string;
  is_external?: boolean;
}

export interface FathomCrmEntity {
  name?: string;
  domain?: string;
}

export interface FathomMeeting {
  recording_id?: string;
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  created_at?: string;
  scheduled_start_time?: string;
  recording_start_time?: string;
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { name?: string; email?: string };
  default_summary?: { template_name?: string; markdown_formatted?: string };
  action_items?: {
    description?: string;
    completed?: boolean;
    assignee?: { name?: string };
  }[];
  crm_matches?: {
    contacts?: FathomCrmEntity[];
    companies?: FathomCrmEntity[];
    deals?: FathomCrmEntity[];
    error?: string;
  };
}

export interface FathomTranscriptLine {
  speaker?: { display_name?: string; matched_calendar_invitee_email?: string | null };
  text?: string;
  timestamp?: string;
}

async function call<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  // Reading the key first means a missing key never becomes a network call.
  const key = apiKey();

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    if (res.status === 401) throw new FathomAuthError();
    if (res.status === 429) throw new FathomRateLimitError();
    throw new FathomError(res.status);
  }
  return (await res.json()) as T;
}

export async function listMeetings(params: {
  createdAfter?: string;
  createdBefore?: string;
  cursor?: string;
}): Promise<{ items: FathomMeeting[]; nextCursor: string | null }> {
  const body = await call<{ items?: FathomMeeting[]; next_cursor?: string | null }>("/meetings", {
    created_after: params.createdAfter,
    created_before: params.createdBefore,
    cursor: params.cursor,
  });
  return { items: body.items ?? [], nextCursor: body.next_cursor ?? null };
}

/** The transcript for one recording.
 *
 *  `destination_url` is deliberately never sent: with it, Fathom answers
 *  asynchronously via callback and returns no transcript, which would surface
 *  here as a meeting that was silently empty. */
export async function getTranscript(recordingId: string): Promise<FathomTranscriptLine[]> {
  const body = await call<{ transcript?: FathomTranscriptLine[] }>(
    `/recordings/${encodeURIComponent(recordingId)}/transcript`,
  );
  return body.transcript ?? [];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/fathom/client.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the mutants**

Each must turn a specific named test red. Revert after each.

1. In `client.ts`, change `body.next_cursor` to `body.nextCursor`. Expected: "passes a cursor through and returns the next one" FAILS.
2. Change the 401 branch to throw `FathomError`. Expected: "throws FathomAuthError on 401" FAILS.
3. Remove the `apiKey()` call from `call` and inline `process.env.FATHOM_API_KEY ?? ""`. Expected: "throws rather than calling fetch when no key is set" FAILS.
4. In `getTranscript`, return `body as unknown as FathomTranscriptLine[]` instead of `body.transcript ?? []`. Expected: "unwraps the transcript array from the response envelope" FAILS.
5. Add `destination_url: "http://x"` to the `getTranscript` params. Expected: "never sends destination_url" FAILS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fathom/config.ts src/lib/fathom/client.ts src/lib/fathom/client.test.ts
git commit -m "feat(fathom): add the Fathom public API client"
```

---

### Task 2: The two tools and their resolver

**Files:**
- Create: `src/lib/fathom/tools.ts`
- Test: `src/lib/fathom/tools.test.ts`

**Interfaces:**
- Consumes: `listMeetings`, `getTranscript`, `FathomAuthError`, `FathomRateLimitError`, `FathomMeeting`, `FathomTranscriptLine` from `./client`; `ToolDef` from `@/lib/advisor/tools`.
- Produces: `FATHOM_TOOLS: ToolDef[]` (two entries), `FATHOM_TOOL_NAMES: Set<string>`, `resolveFathomTool(name, args): Promise<string>`. Task 3 depends on all three.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fathom/tools.test.ts`. Note the fixtures deliberately carry **only** the real wire field names — no `id`, no `markdown` — so resolver code reading a wrong name yields `undefined` and these assertions fail rather than passing on a fixture built to match the bug.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FathomAuthError, FathomRateLimitError, FathomError, type FathomMeeting } from "./client";

const { mockList, mockTranscript } = vi.hoisted(() => ({
  mockList: vi.fn(), mockTranscript: vi.fn(),
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, listMeetings: mockList, getTranscript: mockTranscript };
});

import { FATHOM_TOOLS, FATHOM_TOOL_NAMES, resolveFathomTool } from "./tools";

const acme: FathomMeeting = {
  recording_id: "rec-acme",
  title: "Acme discovery call",
  created_at: "2026-08-10T09:00:00Z",
  calendar_invitees: [
    { name: "Sam Patel", email: "sam@acme.co", email_domain: "acme.co", is_external: true },
  ],
  default_summary: { template_name: "General", markdown_formatted: "They pushed back on the setup fee." },
  action_items: [{ description: "Send revised quote", completed: false, assignee: { name: "Emil" } }],
  crm_matches: { companies: [{ name: "Acme Ltd", domain: "acme.co" }], contacts: [], deals: [] },
};

const globex: FathomMeeting = {
  recording_id: "rec-globex",
  title: "Globex weekly",
  created_at: "2026-08-11T09:00:00Z",
  calendar_invitees: [{ name: "Dana", email: "dana@globex.io", email_domain: "globex.io" }],
  default_summary: { markdown_formatted: "Timeline slipping on the ingest work." },
  crm_matches: { companies: [{ name: "Globex" }] },
};

// No crm_matches at all — company matching must still work off the invitee email.
const initech: FathomMeeting = {
  recording_id: "rec-initech",
  title: "Intro chat",
  created_at: "2026-08-12T09:00:00Z",
  calendar_invitees: [{ name: "Peter", email: "peter@initech.com", email_domain: "initech.com" }],
  default_summary: { markdown_formatted: "Budget not approved yet." },
};

const onePage = (items: FathomMeeting[]) => ({ items, nextCursor: null });

beforeEach(() => {
  mockList.mockReset();
  mockTranscript.mockReset();
  process.env.FATHOM_API_KEY = "test-key";
});
afterEach(() => { delete process.env.FATHOM_API_KEY; });

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

describe("FATHOM_TOOLS", () => {
  it("declares exactly the two tools, requiring a recordingId to read one", () => {
    expect(FATHOM_TOOLS.map((t) => t.name).sort())
      .toEqual(["fathom_read_meeting", "fathom_search_meetings"]);
    expect([...FATHOM_TOOL_NAMES].sort())
      .toEqual(["fathom_read_meeting", "fathom_search_meetings"]);
    const read = FATHOM_TOOLS.find((t) => t.name === "fathom_read_meeting")!;
    expect(read.input_schema.required).toContain("recordingId");
  });
});

describe("fathom_search_meetings", () => {
  it("returns real meeting data, not just a shape", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    const meetings = out.meetings as Record<string, unknown>[];
    expect(meetings[0]).toMatchObject({ id: "rec-acme", title: "Acme discovery call" });
    expect(String(meetings[0].summaryExcerpt)).toContain("pushed back on the setup fee");
  });

  it("filters by company via crm_matches", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { company: "Acme" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-acme"]);
  });

  it("filters by company via the invitee email when crm_matches is absent", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { company: "initech" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-initech"]);
  });

  it("filters by query against the summary, not only the title", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { query: "timeline slipping" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-globex"]);
  });

  it("ANDs company and query", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {
      company: "Acme", query: "timeline slipping",
    }));
    expect(out.meetings).toEqual([]);
  });

  it("returns every meeting in the window when neither filter is given", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(out.meetings).toHaveLength(3);
    expect(out.truncated).toBe(false);
    expect(out.scanned).toBe(3);
  });

  it("asks the API for the requested window", async () => {
    mockList.mockResolvedValue(onePage([]));
    await resolveFathomTool("fathom_search_meetings", { sinceDays: 7 });
    const since = new Date(String(mockList.mock.calls[0][0].createdAfter)).getTime();
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });

  it("honours limit after filtering", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { limit: 2 }));
    expect(out.meetings).toHaveLength(2);
    expect(out.scanned).toBe(3);
  });

  // Silent truncation is the failure this repo keeps producing: a partial scan
  // rendered as a complete answer.
  it("stops at the page cap and says so", async () => {
    mockList.mockResolvedValue({ items: [acme], nextCursor: "more" });
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(mockList).toHaveBeenCalledTimes(5);
    expect(out.truncated).toBe(true);
    expect(out.scanned).toBe(5);
  });

  it("does not claim truncation when the window fits", async () => {
    mockList
      .mockResolvedValueOnce({ items: [acme], nextCursor: "p2" })
      .mockResolvedValueOnce({ items: [globex], nextCursor: null });
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(out.truncated).toBe(false);
    expect(out.scanned).toBe(2);
  });

  it("never fetches a transcript while searching", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    await resolveFathomTool("fathom_search_meetings", {});
    expect(mockTranscript).not.toHaveBeenCalled();
  });
});

describe("fathom_read_meeting", () => {
  it("returns the full summary and action items", async () => {
    mockList.mockResolvedValue(onePage([acme, globex]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(out.title).toBe("Acme discovery call");
    expect(String(out.summary)).toContain("pushed back on the setup fee");
    expect(out.actionItems).toEqual([{ description: "Send revised quote", completed: false, assignee: "Emil" }]);
  });

  it("omits the transcript and makes no transcript call unless asked", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(out.transcript).toBeUndefined();
    expect(mockTranscript).not.toHaveBeenCalled();
  });

  it("includes a speaker-attributed transcript when asked", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    mockTranscript.mockResolvedValue([
      { speaker: { display_name: "Sam Patel" }, text: "The setup fee is the problem", timestamp: "00:04:10" },
    ]);
    const out = parse(await resolveFathomTool("fathom_read_meeting", {
      recordingId: "rec-acme", includeTranscript: true,
    }));
    expect(mockTranscript).toHaveBeenCalledWith("rec-acme");
    expect(String(out.transcript)).toContain("Sam Patel");
    expect(String(out.transcript)).toContain("The setup fee is the problem");
  });

  it("clips an over-budget transcript rather than blowing the turn's budget", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    mockTranscript.mockResolvedValue(
      Array.from({ length: 4000 }, () => ({ speaker: { display_name: "X" }, text: "y".repeat(50) })),
    );
    const out = parse(await resolveFathomTool("fathom_read_meeting", {
      recordingId: "rec-acme", includeTranscript: true,
    }));
    expect(String(out.transcript)).toMatch(/\[truncated\]$/);
    expect(String(out.transcript).length).toBeLessThan(41000);
  });

  // The likeliest cause is a window that is too narrow, so the message says so.
  it("tells the model to widen the window when the id is not in it", async () => {
    mockList.mockResolvedValue(onePage([globex]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(String(out.error)).toMatch(/sinceDays/);
  });
});

describe("failures become prose the model can relay", () => {
  it("reports a rejected key", async () => {
    mockList.mockRejectedValue(new FathomAuthError());
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/API key/i);
  });

  it("reports a rate limit", async () => {
    mockList.mockRejectedValue(new FathomRateLimitError());
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/rate limit/i);
  });

  it("reports an unreachable API without relaying the status text", async () => {
    mockList.mockRejectedValue(new FathomError(503));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/could not be reached/i);
  });

  it("reports a missing key rather than throwing", async () => {
    delete process.env.FATHOM_API_KEY;
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/FATHOM_API_KEY/);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("reports an unknown tool name", async () => {
    const out = parse(await resolveFathomTool("fathom_nope", {}));
    expect(String(out.error)).toContain("unknown tool");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fathom/tools.test.ts`
Expected: FAIL — `./tools` does not exist.

- [ ] **Step 3: Write `tools.ts`**

```ts
/* ============================================================
   The Fathom tools (server-only).

   Two tools: search summaries across a window, and read one meeting in full.
   Never throws — every failure becomes a JSON `{ error }` the model reads and
   relays, the same contract as brain/tools.ts.

   There is no single-meeting endpoint on the Fathom API. GET /meetings is the
   only source of metadata and summaries, so reading one meeting re-pages the
   window to locate it by recording_id.
   ============================================================ */

import type { ToolDef } from "@/lib/advisor/tools";
import {
  listMeetings, getTranscript, isConfigured,
  FathomAuthError, FathomRateLimitError, FathomError,
  type FathomMeeting, type FathomTranscriptLine,
} from "./client";

type Args = Record<string, unknown>;

const MAX_PAGES = 5;
const MAX_TRANSCRIPT_CHARS = 40000;
const SUMMARY_EXCERPT_CHARS = 400;
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_LIMIT = 20;

export const FATHOM_TOOLS: ToolDef[] = [
  {
    name: "fathom_search_meetings",
    description:
      "Search the founder's recorded meetings by company and/or keyword and return compact " +
      "rows: id, title, date, attendees, companies and a summary excerpt. Omit both filters " +
      "for the most recent meetings. Returns `truncated: true` when the scan hit its page " +
      "limit — say so rather than implying you saw everything. Use fathom_read_meeting for " +
      "the full summary or the transcript.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "company name or email domain, e.g. 'Acme' or 'acme.co'" },
        query: { type: "string", description: "keywords matched against the title and summary" },
        sinceDays: { type: "number", description: "how far back to look; default 90" },
        limit: { type: "number", description: "rows to return; default 20" },
      },
    },
  },
  {
    name: "fathom_read_meeting",
    description:
      "One meeting in full: summary, action items, and optionally the speaker-attributed " +
      "transcript. Pass a recordingId from fathom_search_meetings. Leave includeTranscript " +
      "off unless the summary is genuinely not enough — transcripts are long.",
    input_schema: {
      type: "object",
      properties: {
        recordingId: { type: "string", description: "the id from fathom_search_meetings" },
        sinceDays: { type: "number", description: "window to find it in; default 90" },
        includeTranscript: { type: "boolean", description: "default false" },
      },
      required: ["recordingId"],
    },
  },
];

export const FATHOM_TOOL_NAMES = new Set(FATHOM_TOOLS.map((t) => t.name));

const num = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const titleOf = (m: FathomMeeting) => m.title || m.meeting_title || "(untitled)";
const dateOf = (m: FathomMeeting) =>
  (m.recording_start_time || m.scheduled_start_time || m.created_at || "").slice(0, 10);
const summaryOf = (m: FathomMeeting) => m.default_summary?.markdown_formatted ?? "";
const inviteesOf = (m: FathomMeeting) => m.calendar_invitees ?? [];
const companiesOf = (m: FathomMeeting) =>
  (m.crm_matches?.companies ?? []).map((c) => c.name).filter((n): n is string => !!n);

/** Company matching runs over the CRM match Fathom already made AND the invitee
 *  emails, because crm_matches is empty whenever the founder's CRM isn't the one
 *  Fathom is connected to — which is the normal case here. */
const companyHaystack = (m: FathomMeeting) =>
  [
    titleOf(m),
    ...inviteesOf(m).flatMap((i) => [i.name, i.email, i.email_domain]),
    ...(m.crm_matches?.companies ?? []).flatMap((c) => [c.name, c.domain]),
    ...(m.crm_matches?.contacts ?? []).flatMap((c) => [c.name, c.domain]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const queryHaystack = (m: FathomMeeting) =>
  [titleOf(m), summaryOf(m)].join(" ").toLowerCase();

function excerpt(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_EXCERPT_CHARS
    ? `${flat.slice(0, SUMMARY_EXCERPT_CHARS)}…`
    : flat;
}

function renderTranscript(lines: FathomTranscriptLine[]): string {
  const out = lines
    .map((l) => `${l.speaker?.display_name ?? "Unknown"}: ${l.text ?? ""}`)
    .join("\n");
  return out.length > MAX_TRANSCRIPT_CHARS
    ? `${out.slice(0, MAX_TRANSCRIPT_CHARS)}\n[truncated]`
    : out;
}

/** Pages the window, capped. Returns what it saw and whether the cap bit. */
async function scanWindow(sinceDays: number): Promise<{
  meetings: FathomMeeting[];
  truncated: boolean;
}> {
  const createdAfter = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const meetings: FathomMeeting[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await listMeetings({ createdAfter, cursor });
    meetings.push(...items);
    if (!nextCursor) return { meetings, truncated: false };
    cursor = nextCursor;
  }
  // Left the loop with a cursor still outstanding: there is more we did not read.
  return { meetings, truncated: true };
}

async function search(args: Args): Promise<string> {
  const company = text(args.company).toLowerCase();
  const query = text(args.query).toLowerCase();
  const { meetings, truncated } = await scanWindow(num(args.sinceDays, DEFAULT_SINCE_DAYS));

  const matched = meetings.filter(
    (m) =>
      (!company || companyHaystack(m).includes(company)) &&
      (!query || queryHaystack(m).includes(query)),
  );

  return JSON.stringify({
    meetings: matched.slice(0, num(args.limit, DEFAULT_LIMIT)).map((m) => ({
      id: m.recording_id,
      title: titleOf(m),
      date: dateOf(m),
      attendees: inviteesOf(m).map((i) => i.name || i.email).filter(Boolean),
      companies: companiesOf(m),
      summaryExcerpt: excerpt(summaryOf(m)),
    })),
    scanned: meetings.length,
    truncated,
  });
}

async function readMeeting(args: Args): Promise<string> {
  const id = text(args.recordingId);
  if (!id) return JSON.stringify({ error: "recordingId is required." });

  const sinceDays = num(args.sinceDays, DEFAULT_SINCE_DAYS);
  const { meetings } = await scanWindow(sinceDays);
  const meeting = meetings.find((m) => m.recording_id === id);

  if (!meeting) {
    return JSON.stringify({
      error: `No meeting with that id in the last ${sinceDays} days. Try a larger sinceDays.`,
    });
  }

  const body: Record<string, unknown> = {
    title: titleOf(meeting),
    date: dateOf(meeting),
    attendees: inviteesOf(meeting).map((i) => i.name || i.email).filter(Boolean),
    summary: summaryOf(meeting),
    actionItems: (meeting.action_items ?? []).map((a) => ({
      description: a.description,
      completed: a.completed,
      assignee: a.assignee?.name,
    })),
  };

  if (args.includeTranscript === true) {
    body.transcript = renderTranscript(await getTranscript(id));
  }
  return JSON.stringify(body);
}

/** Resolve a Fathom tool call to a JSON string. Never throws — a failure the
 *  model can read and relay beats a turn that dies. */
export async function resolveFathomTool(name: string, args: Args): Promise<string> {
  if (!isConfigured()) {
    return JSON.stringify({
      error: "Fathom is not connected. Add FATHOM_API_KEY to .env.local and restart.",
    });
  }
  try {
    if (name === "fathom_search_meetings") return await search(args);
    if (name === "fathom_read_meeting") return await readMeeting(args);
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    if (e instanceof FathomAuthError) {
      return JSON.stringify({ error: "Fathom rejected the API key." });
    }
    if (e instanceof FathomRateLimitError) {
      return JSON.stringify({ error: "Fathom's rate limit was hit. Try again in a moment." });
    }
    if (e instanceof FathomError) {
      console.error("[fathom] request failed:", e.status);
      return JSON.stringify({ error: "Fathom could not be reached right now." });
    }
    console.error("[fathom] unexpected failure:", e);
    return JSON.stringify({ error: "Fathom could not be reached right now." });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/fathom/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the mutants**

Each must turn a specific named test red. Revert after each.

1. In `summaryOf`, read `m.default_summary?.markdown` instead of `markdown_formatted`. Expected: "returns real meeting data, not just a shape" FAILS on the excerpt.
2. In `search`'s map, emit `id: (m as { id?: string }).id` instead of `m.recording_id`. Expected: the same test FAILS on `id`.
3. In `scanWindow`, return `{ meetings, truncated: false }` after the loop. Expected: "stops at the page cap and says so" FAILS.
4. In `companyHaystack`, drop the `inviteesOf` line. Expected: "filters by company via the invitee email when crm_matches is absent" FAILS.
5. In `queryHaystack`, drop `summaryOf(m)`. Expected: "filters by query against the summary, not only the title" FAILS.
6. In `readMeeting`, always fetch the transcript. Expected: "omits the transcript and makes no transcript call unless asked" FAILS.
7. In `renderTranscript`, remove the clip. Expected: "clips an over-budget transcript" FAILS.
8. In `resolveFathomTool`, remove the `isConfigured()` guard. Expected: "reports a missing key rather than throwing" FAILS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fathom/tools.ts src/lib/fathom/tools.test.ts
git commit -m "feat(fathom): add the search and read meeting tools"
```

---

### Task 3: Wire the group onto the bus, gated

**Files:**
- Modify: `src/lib/agents/types.ts` (add `fathomEnabled` to `AgentContext`)
- Modify: `src/lib/agents/capabilities.ts` (import, `grantsFor`, `dispatch`)
- Modify: `src/lib/brain/availability.ts` (add `resolveFathomEnabled`)
- Test: `src/lib/agents/capabilities.test.ts`

**Interfaces:**
- Consumes: `FATHOM_TOOLS`, `FATHOM_TOOL_NAMES`, `resolveFathomTool` from `@/lib/fathom/tools`; `isConfigured` from `@/lib/fathom/config`.
- Produces: `AgentContext.fathomEnabled: boolean`; `resolveFathomEnabled(spec): boolean`. Task 4 depends on both.

- [ ] **Step 1: Write the failing tests**

In `src/lib/agents/capabilities.test.ts`, add `fathomEnabled: false` to the object literal inside the existing `ctx()` helper (before the `...over` spread), then add:

```ts
describe("the fathom group", () => {
  it("grants both meeting tools when Fathom is configured", () => {
    expect(names(toolsFor(["fathom"], ctx({ fathomEnabled: true }))))
      .toEqual(["fathom_read_meeting", "fathom_search_meetings"]);
  });

  // Same gate as `delivery`: without it an agent receives two tools that answer
  // every call with "not connected" and relays that to the founder as a fact
  // about their own integrations. That has happened twice in this codebase.
  it("grants nothing when Fathom is not configured", () => {
    expect(toolsFor(["fathom"], ctx({ fathomEnabled: false }))).toEqual([]);
  });

  it("routes a fathom tool to its resolver rather than reporting an unknown tool", async () => {
    const out = JSON.parse(await dispatch("fathom_search_meetings", {}, ctx({ fathomEnabled: true })));
    expect(String(out.error ?? "")).not.toContain("unknown tool");
  });
});
```

Then update the existing anti-blindness assertion. It currently reads
`expect(empty).toEqual(["repo", "fathom"])`; `fathom` now has an implementation, so it
becomes `expect(empty).toEqual(["repo"])`. Add `fathomEnabled: true` to the `full()` helper
in that same describe block — without it `fathom` grants `[]` and the guard goes blind to
it, which is exactly what the guard exists to prevent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/agents/capabilities.test.ts`
Expected: FAIL — `fathomEnabled` is not a property of `AgentContext`, and the `empty` assertion still lists `fathom`.

- [ ] **Step 3: Add the context field**

In `src/lib/agents/types.ts`, after `projectSnapshot`:

```ts
  /**
   * Whether FATHOM_API_KEY is set. Resolved server-side; the browser never
   * supplies it. The `fathom` group grants nothing when false, so an agent
   * cannot receive tools that answer every call "not connected".
   */
  fathomEnabled: boolean;
```

- [ ] **Step 4: Wire the bus**

In `src/lib/agents/capabilities.ts`, add the import:

```ts
import { FATHOM_TOOLS, FATHOM_TOOL_NAMES, resolveFathomTool } from "@/lib/fathom/tools";
```

Replace the `fathom` case in `grantsFor`:

```ts
    case "fathom": return ctx.fathomEnabled ? FATHOM_TOOLS : [];
```

And add the branch to `dispatch`, next to the other integration branches:

```ts
    if (FATHOM_TOOL_NAMES.has(name)) return await resolveFathomTool(name, args);
```

- [ ] **Step 5: Add the availability resolver**

In `src/lib/brain/availability.ts`:

```ts
import { isConfigured as fathomConfigured } from "@/lib/fathom/config";

/** Whether an agent's ctx should carry Fathom access.
 *
 *  Synchronous, unlike the email/calendar/Drive resolvers above: this is an env
 *  read, not a DB read, so there is no cost to gate against and nothing to join
 *  in a Promise.all. Still spec-gated for the same reason they are — an agent
 *  that never asks for Fathom should not carry a flag implying it did. */
export function resolveFathomEnabled(spec: Pick<AgentSpec, "tools">): boolean {
  return spec.tools.includes("fathom") && fathomConfigured();
}
```

- [ ] **Step 6: Fix every other `AgentContext` construction**

Run: `npx tsc --noEmit`

Add `fathomEnabled: false` to each site `tsc` names. Do not guess the list — expected sites include the three agent routes and several `.test.ts` files.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 8: Run the mutants**

1. Change the grant to `case "fathom": return FATHOM_TOOLS;`. Expected: "grants nothing when Fathom is not configured" FAILS.
2. Delete the `FATHOM_TOOL_NAMES` branch from `dispatch`. Expected: "routes a fathom tool to its resolver" FAILS.
3. In `capabilities.test.ts`, set the `full()` helper's `fathomEnabled` back to `false`. Expected: the "grants a non-empty tool set for every implemented group" guard FAILS, naming `fathom`. Revert. (This is the anti-blindness guard proving it still works.)
4. In `resolveFathomEnabled`, drop the `spec.tools.includes("fathom")` clause. Expected: no test catches it — if so, add one asserting a spec without `fathom` resolves false, then re-run.

- [ ] **Step 9: Commit**

```bash
git add src/lib/agents/types.ts src/lib/agents/capabilities.ts src/lib/agents/capabilities.test.ts src/lib/brain/availability.ts src/app/api src/lib
git commit -m "feat(agents): grant the fathom tools, gated on the API key being set"
```

---

### Task 4: Routes and personas

**Files:**
- Modify: `src/app/api/advisor/route.ts`, `src/app/api/brain/route.ts`, `src/app/api/projects/chat/route.ts` (set `fathomEnabled`)
- Modify: `src/agents/sales-advisor.md`, `src/agents/discovery-coach.md`, `src/agents/pipeline-analyst.md`
- Test: `src/app/api/advisor/route.test.ts`, `src/lib/agents/roster.test.ts`

**Interfaces:**
- Consumes: `resolveFathomEnabled` from `@/lib/brain/availability`.
- Produces: three personas declaring `fathom`; three routes resolving the flag.

- [ ] **Step 1: Write the failing test**

In `src/app/api/advisor/route.test.ts`, add:

```ts
  it("grants the fathom tools when the API key is set", async () => {
    process.env.FATHOM_API_KEY = "test-key";
    try {
      await call({ messages: msgs, snapshot: emptySnapshot });
      const tools = (mockCreate.mock.calls[0][0].tools as { name: string }[]).map((t) => t.name);
      expect(tools).toContain("fathom_search_meetings");
      expect(tools).toContain("fathom_read_meeting");
    } finally {
      delete process.env.FATHOM_API_KEY;
    }
  });

  // The gate, from the route's side. Without it the advisor receives two tools
  // that answer every call "not connected" and relays that to the founder.
  it("grants no fathom tools when the API key is absent", async () => {
    delete process.env.FATHOM_API_KEY;
    await call({ messages: msgs, snapshot: emptySnapshot });
    const tools = (mockCreate.mock.calls[0][0].tools as { name: string }[]).map((t) => t.name);
    expect(tools.filter((n) => n.startsWith("fathom_"))).toEqual([]);
  });
```

`call`, `msgs` and `emptySnapshot` are that file's existing module-level helpers — reuse
them, do not define new ones. Put both tests inside the describe block that already uses
`call`, and make sure `FATHOM_API_KEY` is deleted in a `finally` or an `afterEach` so it
cannot leak into a sibling test and silently flip the second assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/advisor/route.test.ts`
Expected: FAIL — `sales-advisor` does not declare `fathom`, and the route pins `fathomEnabled: false`.

- [ ] **Step 3: Declare the group on the three personas**

In each of `src/agents/sales-advisor.md`, `src/agents/discovery-coach.md` and
`src/agents/pipeline-analyst.md`, add `fathom` to the frontmatter `tools` array.

Then add one paragraph to each body. `sales-advisor`:

> Every sales call is recorded in Fathom. Use `fathom_search_meetings` with the company name when the founder asks what was said, agreed or objected to on a call — typed interaction notes are a summary written afterwards; the meeting is the source. Reach for `fathom_read_meeting` when you need the full summary, and only set `includeTranscript` when the summary genuinely does not answer the question. If a search comes back `truncated`, say you only saw part of the window.

`discovery-coach`:

> Past calls are in Fathom. Before coaching a discovery call, use `fathom_search_meetings` on that company to see what was already asked and what went unanswered, so you push on the gaps rather than repeating ground. `fathom_read_meeting` with `includeTranscript` is worth it when you are critiquing how a question was actually phrased.

`pipeline-analyst`:

> Use `fathom_search_meetings` across companies to find patterns — recurring objections, which pitches land, which discovery questions get real answers. Search with a keyword and no company to read across deals. Ground claims in what was actually said, and if a search comes back `truncated`, say the pattern is from a partial scan.

- [ ] **Step 4: Resolve the flag in the three routes**

In `src/app/api/advisor/route.ts` and `src/app/api/brain/route.ts`, import
`resolveFathomEnabled` alongside the existing availability imports and set
`fathomEnabled: resolveFathomEnabled(spec)` on the context.

In `src/app/api/projects/chat/route.ts`, do the same. `project-agent` declares only
`delivery`, so it resolves false — wire it anyway, for the reason `advisor/route.ts`
already records about Drive: granting a capability in the agent file should be all it
takes, rather than requiring a route change nobody remembers to make.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green. `roster.test.ts` exercises every shipped agent — if its
fixture needs `fathomEnabled: true` to keep its "every implemented group grants something"
posture honest, set it there too.

- [ ] **Step 6: Run the mutants**

1. Remove `fathom` from `sales-advisor.md`'s tools. Expected: "grants the fathom tools when the API key is set" FAILS.
2. Change the route to `fathomEnabled: true` unconditionally. Expected: "grants no fathom tools when the API key is absent" FAILS.

- [ ] **Step 7: Commit**

```bash
git add src/agents src/app/api
git commit -m "feat(agents): give the advisor, discovery coach and pipeline analyst Fathom access"
```

---

### Task 5: Whole-branch verification

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run the gates**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Record actual output. Do not paraphrase a pass.

- [ ] **Step 2: Confirm no test reaches the network**

```bash
grep -rn "api.fathom.ai" src/ --include="*.test.ts"
```

Expected: no matches outside an assertion on a stubbed call's URL. A test that would
actually dial out is a defect even if it passes.

- [ ] **Step 3: Confirm the wire names are the documented ones**

```bash
grep -rn "\.markdown\b\|\.id\b" src/lib/fathom/tools.ts src/lib/fathom/client.ts
```

Expected: no read of `default_summary.markdown` and no read of a meeting's `.id` — the
documented names are `markdown_formatted` and `recording_id`. Matches inside unrelated
expressions are fine; a read of either wrong name is a defect that fixtures cannot catch.

- [ ] **Step 4: Confirm no test touched the real database**

```bash
sqlite3 data/pallisade.db "select 'leads', count(*) from leads union all select 'quotes', count(*) from quotes union all select 'projects', count(*) from projects union all select 'milestones', count(*) from milestones;"
```

Expected: leads 11, quotes 3, projects 5, milestones 7. Row counts, not a checksum.

- [ ] **Step 5: Write the STATUS document**

Write `docs/superpowers/plans/2026-08-19-fathom-tools-STATUS.md` from the ledger and the
per-task reports: what was built per task, which mutants ran and what each proved, every
review finding with a "caught where" column (plan vs implementation), the deferred minors,
and what remains unverified. The two prior branches ran 11-of-14 and 8-of-8 in the plan;
compute this branch's ratio.

Record explicitly that **no call has been made against the real Fathom API** — every test
stubs `fetch` — so the field mapping is verified against the documentation, not against a
live response. That is the one thing only a real key can settle.

```bash
git add docs/superpowers/plans/2026-08-19-fathom-tools-STATUS.md
git commit -m "docs(fathom): status for the Fathom meeting tools"
```
