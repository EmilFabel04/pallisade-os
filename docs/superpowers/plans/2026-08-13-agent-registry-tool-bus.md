# Agent Registry and Tool Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three hand-rolled AI route loops with one runtime driven by agent files, so a persona is a markdown file with a declared toolset rather than a route.

**Architecture:** An agent is `src/agents/<id>.md` — `agency-agents` YAML frontmatter plus a system-prompt body — validated at load into an `AgentSpec`. Nine capability groups map group names to the tool arrays that already exist, and one `runAgent()` owns the model call and tool-use cycle. The keyword-matching mock in `src/lib/ai.ts` is deleted; failures surface as typed errors instead of being rendered as answers.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.7, `@anthropic-ai/sdk`, `@libsql/client` (SQLite/Turso), vitest.

**Spec:** [../specs/2026-08-13-agent-registry-tool-bus-design.md](../specs/2026-08-13-agent-registry-tool-bus-design.md)

## Global Constraints

- **No new runtime dependencies.** The app carries 11; frontmatter is hand-rolled, not `gray-matter`/`js-yaml`.
- **Model:** `claude-sonnet-4-6`. **Iteration cap:** 8. Both live in one place after Task 6.
- **Tests** are colocated `src/**/*.test.ts`, run by `npx vitest run`. Alias `@` → `src`.
- **Route errors** use `apiError(code, status, cause)` from `@/lib/api/errors` — never a raw message, never a stack trace to the client.
- **Server-only modules** (anything importing `@/lib/db/client` or reading `process.env`) must never be imported from a `"use client"` file.
- **`agentOverrides` must NOT be added to `COLLECTIONS`** in `src/lib/db/sqlite.ts`. `saveAll()` deletes and reinserts every listed collection from a client snapshot, so a stale browser tab would wipe server-authored rows. Follow the `src/lib/content/daily/store.ts` pattern instead.
- **Baseline:** 824 tests passing before this work. Never commit with a red suite.
- **Never let a test touch `data/pallisade.db`.** `getClient()` defaults to it and it holds real leads, quotes and interactions. Any test exercising a DB-backed module must set `TURSO_DATABASE_URL` to a temp file in `beforeAll`, before the first DB call.
- **Apostrophe fold:** any new code that matches model-generated text must fold typographic apostrophes (`’` → `'`) before matching, per `gate.ts`.

---

### Task 1: Frontmatter parser

**Files:**
- Create: `src/lib/agents/frontmatter.ts`
- Test: `src/lib/agents/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseFrontmatter(source: string): { meta: Record<string, string | string[]>; body: string }`. Throws `Error` when the block is absent or unterminated.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/lib/agents/frontmatter";

const DOC = `---
name: Deal Strategist
description: Pressure-tests live deals.
color: "#10B981"
emoji: 🎯
surface: brain
tools: [crm, projects, web]
---
You are Deal Strategist.

Second paragraph.`;

describe("parseFrontmatter", () => {
  it("reads scalars, quoted scalars and flat arrays", () => {
    const { meta } = parseFrontmatter(DOC);
    expect(meta.name).toBe("Deal Strategist");
    expect(meta.color).toBe("#10B981");          // quotes stripped
    expect(meta.emoji).toBe("🎯");
    expect(meta.tools).toEqual(["crm", "projects", "web"]);
  });

  it("returns the body with the delimiter block removed", () => {
    const { body } = parseFrontmatter(DOC);
    expect(body).toBe("You are Deal Strategist.\n\nSecond paragraph.");
  });

  it("keeps a --- that appears inside the body", () => {
    const { body } = parseFrontmatter("---\nname: X\n---\nintro\n\n---\n\nafter");
    expect(body).toBe("intro\n\n---\n\nafter");
  });

  it("tolerates CRLF line endings", () => {
    const { meta, body } = parseFrontmatter("---\r\nname: X\r\n---\r\nbody here");
    expect(meta.name).toBe("X");
    expect(body).toBe("body here");
  });

  it("throws when no frontmatter block is present", () => {
    expect(() => parseFrontmatter("just a body")).toThrow(/frontmatter/i);
  });

  it("throws when the block is unterminated", () => {
    expect(() => parseFrontmatter("---\nname: X\nbody")).toThrow(/unterminated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/frontmatter.test.ts`
Expected: FAIL — "Failed to resolve import" / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/* ============================================================
   Frontmatter parser for agent files.

   Deliberately not a YAML library. Every field in every agent file is a
   scalar or a flat string array, and the app carries no YAML dependency.
   If a file ever needs nested YAML, add the dependency then — do not grow
   this into a parser.
   ============================================================ */

export interface Frontmatter {
  meta: Record<string, string | string[]>;
  body: string;
}

const DELIM = /^---[ \t]*$/;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

function parseValue(raw: string): string | string[] {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map(unquote).filter((s) => s.length > 0);
  }
  return unquote(t);
}

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (!DELIM.test(lines[0] ?? "")) {
    throw new Error("missing frontmatter: file must start with ---");
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i])) { end = i; break; }
  }
  if (end === -1) throw new Error("unterminated frontmatter: no closing ---");

  const meta: Record<string, string | string[]> = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = parseValue(line.slice(colon + 1));
  }

  return { meta, body: lines.slice(end + 1).join("\n").trim() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/frontmatter.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/frontmatter.ts src/lib/agents/frontmatter.test.ts
git commit -m "feat(agents): frontmatter parser for agent files"
```

---

### Task 2: Agent types and spec validation

**Files:**
- Create: `src/lib/agents/types.ts`, `src/lib/agents/spec.ts`
- Test: `src/lib/agents/spec.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 1).
- Produces:
  - `CAPABILITY_GROUPS: readonly CapabilityGroup[]`, `type CapabilityGroup = "crm" | "email" | "calendar" | "drive" | "projects" | "web" | "writes" | "repo" | "fathom"`
  - `AGENT_SURFACES: readonly AgentSurface[]`, `type AgentSurface = "brain" | "advisor" | "project"`
  - `interface AgentSpec { id; name; description; color; emoji; vibe; surface; tools; model?; body }`
  - `interface AgentCard { id; name; description; color; emoji; vibe }` — the browser-safe projection
  - `interface AgentContext { today; businessName; founderName; services; snapshot; proposals; emailEnabled; calendarEnabled; driveAccountId }`
  - `buildSpec(id: string, source: string): AgentSpec` — throws on any validation failure
  - `toCard(spec: AgentSpec): AgentCard`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSpec, toCard } from "@/lib/agents/spec";

const OK = `---
name: Deal Strategist
description: Pressure-tests live deals.
color: "#10B981"
emoji: 🎯
vibe: Asks what has to be true for this to close.
surface: brain
tools: [crm, projects]
---
You are Deal Strategist.`;

describe("buildSpec", () => {
  it("builds a spec from a valid file", () => {
    const s = buildSpec("deal-strategist", OK);
    expect(s.id).toBe("deal-strategist");
    expect(s.surface).toBe("brain");
    expect(s.tools).toEqual(["crm", "projects"]);
    expect(s.body).toBe("You are Deal Strategist.");
    expect(s.model).toBeUndefined();
  });

  it("rejects an unknown capability group, naming file and field", () => {
    const bad = OK.replace("[crm, projects]", "[crm, crmm]");
    expect(() => buildSpec("deal-strategist", bad))
      .toThrow(/deal-strategist.*tools.*crmm/s);
  });

  it("rejects an unknown surface", () => {
    const bad = OK.replace("surface: brain", "surface: nowhere");
    expect(() => buildSpec("deal-strategist", bad)).toThrow(/surface.*nowhere/s);
  });

  it("rejects a missing required field", () => {
    const bad = OK.replace("name: Deal Strategist\n", "");
    expect(() => buildSpec("deal-strategist", bad)).toThrow(/deal-strategist.*name/s);
  });

  it("rejects an empty body", () => {
    expect(() => buildSpec("x", `---\nname: N\ndescription: D\ncolor: "#fff"\nemoji: X\nvibe: V\nsurface: brain\ntools: [crm]\n---\n`))
      .toThrow(/body/i);
  });

  it("accepts an empty tools list", () => {
    const s = buildSpec("x", OK.replace("[crm, projects]", "[]"));
    expect(s.tools).toEqual([]);
  });

  it("reads an optional model override", () => {
    const s = buildSpec("x", OK.replace("surface: brain", "surface: brain\nmodel: claude-opus-4-6"));
    expect(s.model).toBe("claude-opus-4-6");
  });
});

describe("toCard", () => {
  it("projects exactly the presentation fields and nothing else", () => {
    const card = toCard(buildSpec("deal-strategist", OK));
    // Exact key set — a superset would leak the system prompt to the browser.
    expect(Object.keys(card).sort())
      .toEqual(["color", "description", "emoji", "id", "name", "vibe"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/spec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/agents/types.ts`:

```ts
import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";

export const CAPABILITY_GROUPS = [
  "crm", "email", "calendar", "drive", "projects", "web", "writes", "repo", "fathom",
] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export const AGENT_SURFACES = ["brain", "advisor", "project"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

export interface AgentSpec {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
  surface: AgentSurface;
  tools: CapabilityGroup[];
  model?: string;
  body: string;
}

/** Browser-safe projection. Never carries `body` or `tools`. */
export interface AgentCard {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
}

/**
 * Everything a tool resolver may need, assembled SERVER-SIDE.
 * The client sends an agentId and messages; it never supplies this.
 */
export interface AgentContext {
  today: string;
  businessName: string;
  founderName: string;
  services: string;
  snapshot: AdvisorSnapshot | null;
  proposals: ProposedAction[];
  emailEnabled: boolean;
  calendarEnabled: boolean;
  driveAccountId: string | null;
}
```

`src/lib/agents/spec.ts`:

```ts
import { parseFrontmatter } from "./frontmatter";
import {
  AGENT_SURFACES, CAPABILITY_GROUPS,
  type AgentCard, type AgentSpec, type AgentSurface, type CapabilityGroup,
} from "./types";

const REQUIRED = ["name", "description", "color", "emoji", "vibe", "surface"] as const;

function str(meta: Record<string, string | string[]>, key: string, id: string): string {
  const v = meta[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`agent "${id}": field "${key}" is required and must be a non-empty string`);
  }
  return v;
}

export function buildSpec(id: string, source: string): AgentSpec {
  const { meta, body } = parseFrontmatter(source);

  for (const key of REQUIRED) str(meta, key, id);

  const surface = meta.surface as string;
  if (!(AGENT_SURFACES as readonly string[]).includes(surface)) {
    throw new Error(
      `agent "${id}": field "surface" has unknown value "${surface}" ` +
      `(expected one of ${AGENT_SURFACES.join(", ")})`,
    );
  }

  const rawTools = meta.tools ?? [];
  const tools = Array.isArray(rawTools) ? rawTools : [rawTools];
  for (const t of tools) {
    if (!(CAPABILITY_GROUPS as readonly string[]).includes(t)) {
      throw new Error(
        `agent "${id}": field "tools" has unknown capability group "${t}" ` +
        `(expected one of ${CAPABILITY_GROUPS.join(", ")})`,
      );
    }
  }

  if (!body.trim()) throw new Error(`agent "${id}": body (system prompt) is empty`);

  const model = typeof meta.model === "string" && meta.model.trim() ? meta.model : undefined;

  return {
    id,
    name: str(meta, "name", id),
    description: str(meta, "description", id),
    color: str(meta, "color", id),
    emoji: str(meta, "emoji", id),
    vibe: str(meta, "vibe", id),
    surface: surface as AgentSurface,
    tools: tools as CapabilityGroup[],
    ...(model ? { model } : {}),
    body,
  };
}

export function toCard(spec: AgentSpec): AgentCard {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    color: spec.color,
    emoji: spec.emoji,
    vibe: spec.vibe,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/spec.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/types.ts src/lib/agents/spec.ts src/lib/agents/spec.test.ts
git commit -m "feat(agents): agent spec types and validation"
```

---

### Task 3: Capability groups and the tool bus

**Files:**
- Create: `src/lib/agents/capabilities.ts`
- Test: `src/lib/agents/capabilities.test.ts`
- Modify: `src/lib/advisor/tools.ts` — export `WRITE_TOOL_NAMES` and split read from write tool arrays

**Interfaces:**
- Consumes: `CapabilityGroup`, `AgentContext` (Task 2); existing `TOOLS`, `EMAIL_TOOLS`, `CALENDAR_TOOLS`, `DRIVE_TOOLS`, `PROJECT_CONTEXT_TOOLS` and their resolvers.
- Produces:
  - `type AgentTool = ToolDef | ServerToolDef`
  - `SERVER_TOOL_NAMES: Set<string>` — tools Anthropic executes server-side; the runtime must not answer them with a `tool_result`
  - `toolsFor(groups: CapabilityGroup[], ctx: AgentContext): AgentTool[]`
  - `dispatch(name: string, args: Record<string, unknown>, ctx: AgentContext): Promise<string>`

**Note on `web`:** `web_search` is `{ type: "web_search_20250305", name: "web_search", max_uses: 5 }` — a different shape from `ToolDef` (no `input_schema`), executed by Anthropic, and it must never receive a synthetic `tool_result` (see `brain/route.ts:123-124`). `SERVER_TOOL_NAMES` is how the runtime knows.

**Note on `email`/`calendar`:** these resolve to `[]` when the integration is not connected, mirroring `advisor/route.ts:80-89`. The availability flags arrive on `ctx`, already resolved server-side.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toolsFor, dispatch, SERVER_TOOL_NAMES } from "@/lib/agents/capabilities";
import type { AgentContext } from "@/lib/agents/types";
import type { AdvisorSnapshot } from "@/lib/types";

function snapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], dialLists: [], milestones: [], quotes: [], comparables: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
      targetMarginPct: 0.4, minimumSetupFee: 0, usdToZar: 0,
      capexMultipliers: { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 },
    },
  };
}

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    today: "2026-08-13", businessName: "Pallisade", founderName: "Emil",
    services: "AI systems", snapshot: snapshot(), proposals: [],
    emailEnabled: false, calendarEnabled: false, driveAccountId: null,
    ...over,
  };
}

const names = (ts: { name: string }[]) => ts.map((t) => t.name).sort();

describe("toolsFor", () => {
  it("resolves crm to the exact read tool set, without write tools", () => {
    expect(names(toolsFor(["crm"], ctx()))).toEqual([
      "get_pipeline_metrics", "query_interactions", "query_leads",
      "query_projects", "query_tasks", "search_pain_points",
    ]);
  });

  it("resolves writes to the exact mutation set", () => {
    expect(names(toolsFor(["writes"], ctx()))).toEqual([
      "create_lead", "create_project", "create_task",
      "log_interaction", "update_lead", "update_task",
    ]);
  });

  it("grants no mutation tools when writes is absent", () => {
    const granted = names(toolsFor(["crm", "projects", "email", "calendar", "drive", "web"], ctx({
      emailEnabled: true, calendarEnabled: true,
    })));
    for (const w of ["create_task", "create_lead", "update_lead", "update_task", "log_interaction", "create_project"]) {
      expect(granted).not.toContain(w);
    }
  });

  it("omits email and calendar tools when those integrations are off", () => {
    expect(toolsFor(["email", "calendar"], ctx())).toEqual([]);
  });

  it("includes email and calendar tools when connected", () => {
    const granted = names(toolsFor(["email", "calendar"], ctx({ emailEnabled: true, calendarEnabled: true })));
    expect(granted).toContain("query_emails");
    expect(granted).toContain("query_calendar");
  });

  it("marks web_search as a server-executed tool", () => {
    const web = toolsFor(["web"], ctx());
    expect(web).toHaveLength(1);
    expect(SERVER_TOOL_NAMES.has("web_search")).toBe(true);
  });

  it("dedupes a tool reachable from two groups", () => {
    const once = names(toolsFor(["crm"], ctx()));
    const twice = names(toolsFor(["crm", "crm"], ctx()));
    expect(twice).toEqual(once);
  });

  it("returns [] for no groups", () => {
    expect(toolsFor([], ctx())).toEqual([]);
  });
});

describe("dispatch", () => {
  it("routes a crm read to the advisor resolver", async () => {
    const out = await dispatch("query_leads", { limit: 5 }, ctx());
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("queues a write as a proposal instead of mutating", async () => {
    const c = ctx();
    const out = await dispatch("create_task", { title: "Call Acme" }, c);
    expect(JSON.parse(out).queued).toBe(true);
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0].description).toContain("Call Acme");
  });

  it("returns an error payload for an unknown tool rather than throwing", async () => {
    const out = await dispatch("no_such_tool", {}, ctx());
    expect(JSON.parse(out).error).toMatch(/unknown tool/i);
  });

  it("returns an error payload when a resolver throws", async () => {
    // snapshot: null forces the crm resolver to fail
    const out = await dispatch("query_leads", {}, ctx({ snapshot: null }));
    expect(JSON.parse(out).error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/capabilities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Split read and write tools in `src/lib/advisor/tools.ts`**

`TOOLS` currently holds reads, "skills" and writes in one array, and `WRITE_TOOLS` (line 155) is module-private. Export the split so `capabilities.ts` can build groups without re-listing names.

```ts
// Replace the single `export const TOOLS` with three arrays and keep TOOLS as
// their concatenation, so existing importers and tests keep working.
export const READ_TOOLS: ToolDef[] = [ /* query_leads … get_pipeline_metrics */ ];
export const WRITE_TOOLS_DEFS: ToolDef[] = [ /* create_task … create_project */ ];
export const TOOLS: ToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS_DEFS];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS_DEFS.map((t) => t.name));
export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));
```

The three `generate_*` "skill" tools are deliberately dropped from `TOOLS` here — Tasks 9 and 10 retire them. Delete their schema entries and their `case` arms in `resolveTool`, and delete the now-unused `import { generateCallSummary, generateBusinessReview, generateTomorrowPlan } from "@/lib/ai"` at the top of the file.

Replace the private `const WRITE_TOOLS = new Set([...])` at line 155 with `WRITE_TOOL_NAMES` and update its use at line 199.

- [ ] **Step 3b: Write `src/lib/agents/capabilities.ts`**

```ts
/* ============================================================
   The tool bus (server-only).

   Maps a capability group to the tools it grants, and routes a tool call to
   the resolver that owns it. This is the single place that knows which
   resolver owns which tool — it replaces the four *_TOOL_NAMES sets that were
   duplicated across the advisor, brain and project-chat routes.
   ============================================================ */

import type { ToolDef } from "@/lib/advisor/tools";
import {
  READ_TOOLS, WRITE_TOOLS_DEFS, WRITE_TOOL_NAMES, READ_TOOL_NAMES, resolveTool,
} from "@/lib/advisor/tools";
import {
  EMAIL_TOOLS, EMAIL_TOOL_NAMES, CALENDAR_TOOLS, CALENDAR_READ_TOOL_NAMES,
} from "@/lib/advisor/tools";
import { resolveEmailTool } from "@/lib/gmail/advisorEmail";
import { resolveCalendarTool } from "@/lib/calendar/advisorCalendar";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "@/lib/brain/tools";
import {
  PROJECT_CONTEXT_TOOLS, PROJECT_CONTEXT_TOOL_NAMES, resolveProjectContextTool,
} from "@/lib/projects/projectContext";
import type { AgentContext, CapabilityGroup } from "./types";

type Args = Record<string, unknown>;

/** Anthropic-executed tool: different shape, and never answered with a tool_result. */
export interface ServerToolDef { type: string; name: string; max_uses?: number }
export type AgentTool = ToolDef | ServerToolDef;

const WEB_SEARCH: ServerToolDef = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

/** Tools Anthropic runs on its own side. The runtime must not synthesise results for these. */
export const SERVER_TOOL_NAMES = new Set([WEB_SEARCH.name]);

/** Groups whose tools are only offered when the integration is connected. */
function grantsFor(group: CapabilityGroup, ctx: AgentContext): AgentTool[] {
  switch (group) {
    case "crm": return READ_TOOLS;
    case "writes": return WRITE_TOOLS_DEFS;
    case "projects": return PROJECT_CONTEXT_TOOLS;
    case "drive": return DRIVE_TOOLS;
    case "web": return [WEB_SEARCH];
    case "email": return ctx.emailEnabled ? EMAIL_TOOLS : [];
    case "calendar": return ctx.calendarEnabled ? CALENDAR_TOOLS : [];
    // Specified in the design, implemented in follow-up specs. An agent may
    // declare them today and simply receive nothing.
    case "repo": return [];
    case "fathom": return [];
  }
}

export function toolsFor(groups: CapabilityGroup[], ctx: AgentContext): AgentTool[] {
  const seen = new Set<string>();
  const out: AgentTool[] = [];
  for (const g of groups) {
    for (const t of grantsFor(g, ctx)) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

export async function dispatch(name: string, args: Args, ctx: AgentContext): Promise<string> {
  try {
    if (EMAIL_TOOL_NAMES.has(name)) return await resolveEmailTool(name, args);
    if (CALENDAR_READ_TOOL_NAMES.has(name)) return await resolveCalendarTool(name, args);
    if (PROJECT_CONTEXT_TOOL_NAMES.has(name)) return await resolveProjectContextTool(name, args);
    if (DRIVE_TOOL_NAMES.has(name)) return await resolveBrainTool(name, args, ctx.driveAccountId);

    if (READ_TOOL_NAMES.has(name) || WRITE_TOOL_NAMES.has(name)) {
      if (!ctx.snapshot) throw new Error("no snapshot available for this tool");
      return resolveTool(name, args, ctx.snapshot, ctx.proposals);
    }

    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (err) {
    // A tool failure is reported to the agent, not thrown — it can then say it
    // could not reach the calendar rather than the whole turn dying.
    return JSON.stringify({ error: (err as Error).message });
  }
}
```

Note: `create_calendar_event` is in `CALENDAR_TOOLS` but not `CALENDAR_READ_TOOL_NAMES`, and it is a write. Add it to `WRITE_TOOLS_DEFS`' name set handling by ensuring `dispatch` checks `WRITE_TOOL_NAMES` before `CALENDAR_READ_TOOL_NAMES` is consulted — it already does, because `CALENDAR_READ_TOOL_NAMES` contains only `query_calendar`, and `create_calendar_event` falls through to `resolveTool`'s write path. Verify this with the test below.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/agents/capabilities.test.ts src/lib/advisor`
Expected: PASS. Existing advisor tests must stay green — if `tools.test.ts` asserts `generate_call_summary` is in `TOOLS`, update that assertion, since Task 10 removes the tool.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/capabilities.ts src/lib/agents/capabilities.test.ts src/lib/advisor/tools.ts src/lib/advisor/tools.test.ts
git commit -m "feat(agents): capability groups and tool bus"
```

---

### Task 4: Agent overrides store

**Files:**
- Create: `src/lib/agents/overrides.ts`
- Test: `src/lib/agents/overrides.test.ts`

**Interfaces:**
- Consumes: `getClient` from `@/lib/db/client`.
- Produces: `ensureAgentSchema(): Promise<void>`, `loadOverrides(): Promise<Map<string, string>>`, `saveOverride(id: string, body: string): Promise<void>`, `clearOverride(id: string): Promise<void>`.

**Critical:** follow `src/lib/content/daily/store.ts` exactly. Do NOT add `agentOverrides` to `COLLECTIONS` in `src/lib/db/sqlite.ts` — `saveAll()` would let a stale browser tab delete every override.

- [ ] **Step 1: Write the failing test**

**Database isolation is mandatory here.** `getClient()` (`src/lib/db/client.ts:16`) defaults
to `file:data/pallisade.db` — the founder's real database. No existing test touches the DB,
so there is no pattern to copy. Point `TURSO_DATABASE_URL` at a temp file in `beforeAll`
**before the first DB call**. This is safe with static imports because `getClient()` reads
the env lazily and memoises only on first call, and vitest gives each test file its own
module registry.

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAgentSchema, loadOverrides, saveOverride, clearOverride } from "@/lib/agents/overrides";
import { getClient } from "@/lib/db/client";

let dir: string;

describe("agent overrides", () => {
  beforeAll(() => {
    // MUST run before any getClient() call, or this test writes to real data.
    dir = mkdtempSync(join(tmpdir(), "agentdb-"));
    process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await ensureAgentSchema();
    await getClient().execute("DELETE FROM agentOverrides");
  });

  it("returns an empty map when nothing is overridden", async () => {
    expect((await loadOverrides()).size).toBe(0);
  });

  it("round-trips a saved body", async () => {
    await saveOverride("deal-strategist", "custom prompt");
    expect((await loadOverrides()).get("deal-strategist")).toBe("custom prompt");
  });

  it("replaces an existing override rather than duplicating it", async () => {
    await saveOverride("deal-strategist", "first");
    await saveOverride("deal-strategist", "second");
    const m = await loadOverrides();
    expect(m.size).toBe(1);
    expect(m.get("deal-strategist")).toBe("second");
  });

  it("clears an override", async () => {
    await saveOverride("deal-strategist", "custom");
    await clearOverride("deal-strategist");
    expect((await loadOverrides()).has("deal-strategist")).toBe(false);
  });

  it("clearing an absent override is a no-op", async () => {
    await expect(clearOverride("never-existed")).resolves.toBeUndefined();
  });
});
```

The same isolation applies to Task 16's route test, which also writes overrides. Any future
test that calls a DB-backed module must do this — `data/pallisade.db` holds the founder's
real leads, quotes and interactions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/overrides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/* ============================================================
   Server-authored persistence for agent body overrides.

   Deliberately NOT in the COLLECTIONS array in src/lib/db/sqlite.ts.
   saveAll() there deletes and reinserts every listed collection from a
   client-supplied snapshot, so a browser tab opened before an override was
   written would wipe it on its next save. See content/daily/store.ts.

   Only the BODY is overridable. Frontmatter — and therefore the tool grant —
   stays file-owned, so editing a persona in Settings can never widen its
   capabilities.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import { nowISO } from "@/lib/utils";

let schemaReady: Promise<void> | null = null;

export async function ensureAgentSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS agentOverrides (
                id         TEXT PRIMARY KEY,
                body       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
    ];
    await getClient().batch(stmts, "write");
  })();
  return schemaReady;
}

export async function loadOverrides(): Promise<Map<string, string>> {
  await ensureAgentSchema();
  const res = await getClient().execute("SELECT id, body FROM agentOverrides");
  return new Map(res.rows.map((r) => [r.id as string, r.body as string]));
}

export async function saveOverride(id: string, body: string): Promise<void> {
  await ensureAgentSchema();
  await getClient().execute({
    sql: `INSERT INTO agentOverrides (id, body, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    args: [id, body, nowISO()],
  });
}

export async function clearOverride(id: string): Promise<void> {
  await ensureAgentSchema();
  await getClient().execute({ sql: `DELETE FROM agentOverrides WHERE id = ?`, args: [id] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/overrides.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/overrides.ts src/lib/agents/overrides.test.ts
git commit -m "feat(agents): server-authored override store"
```

---

### Task 5: Registry

**Files:**
- Create: `src/lib/agents/registry.ts`
- Test: `src/lib/agents/registry.test.ts`
- Create: `src/agents/.gitkeep` (real files land in Task 7)

**Interfaces:**
- Consumes: `buildSpec`, `toCard` (Task 2); `loadOverrides` (Task 4).
- Produces: `loadRegistry(dir?: string): Promise<Map<string, AgentSpec>>`, `getAgent(id: string): Promise<AgentSpec>` (throws `AgentNotFound`), `listAgents(surface: AgentSurface): Promise<AgentCard[]>`, `resetRegistryCache(): void` (tests only).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry } from "@/lib/agents/registry";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const file = (name: string, surface: string) =>
  `---\nname: ${name}\ndescription: D\ncolor: "#fff"\nemoji: A\nvibe: V\nsurface: ${surface}\ntools: [crm]\n---\nBODY ${name}`;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("loadRegistry", () => {
  it("loads every .md file, keyed by filename without extension", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain"), "b.md": file("B", "advisor") });
    dirs.push(dir);
    const reg = await loadRegistry(dir);
    expect([...reg.keys()].sort()).toEqual(["a", "b"]);
    expect(reg.get("a")!.name).toBe("A");
  });

  it("ignores non-markdown files", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain"), "notes.txt": "ignore me" });
    dirs.push(dir);
    expect((await loadRegistry(dir)).size).toBe(1);
  });

  it("throws with the filename when one agent file is invalid", async () => {
    const dir = fixtureDir({ "broken.md": file("A", "nowhere") });
    dirs.push(dir);
    await expect(loadRegistry(dir)).rejects.toThrow(/broken.*surface/s);
  });
});
```

A second describe block covers override precedence and `listAgents` filtering; write it against the same fixture helper, stubbing `loadOverrides` with `vi.mock("@/lib/agents/overrides", ...)` to return `new Map([["a", "OVERRIDDEN"]])` and asserting `reg.get("a")!.body === "OVERRIDDEN"` while `reg.get("a")!.name` still comes from the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/* Server-only. Reads src/agents/*.md, validates, applies body overrides. */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSpec, toCard } from "./spec";
import { loadOverrides } from "./overrides";
import type { AgentCard, AgentSpec, AgentSurface } from "./types";

const AGENTS_DIR = join(process.cwd(), "src", "agents");

export class AgentNotFound extends Error {
  constructor(id: string) { super(`unknown agent: ${id}`); }
}

let cache: Promise<Map<string, AgentSpec>> | null = null;

export async function loadRegistry(dir: string = AGENTS_DIR): Promise<Map<string, AgentSpec>> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const overrides = await loadOverrides();

  const specs = await Promise.all(
    names.map(async (f) => {
      const id = f.slice(0, -3);
      const spec = buildSpec(id, await readFile(join(dir, f), "utf8"));
      const body = overrides.get(id);
      return body ? { ...spec, body } : spec;
    }),
  );

  return new Map(specs.map((s) => [s.id, s]));
}

function registry(): Promise<Map<string, AgentSpec>> {
  if (!cache) cache = loadRegistry();
  return cache;
}

/** Tests and the Settings editor call this after writing an override. */
export function resetRegistryCache(): void { cache = null; }

export async function getAgent(id: string): Promise<AgentSpec> {
  const spec = (await registry()).get(id);
  if (!spec) throw new AgentNotFound(id);
  return spec;
}

export async function listAgents(surface: AgentSurface): Promise<AgentCard[]> {
  return [...(await registry()).values()]
    .filter((s) => s.surface === surface)
    .map(toCard)
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/registry.ts src/lib/agents/registry.test.ts src/agents/.gitkeep
git commit -m "feat(agents): registry with file defaults and db overrides"
```

---

### Task 6: The agent runtime

**Files:**
- Create: `src/lib/agents/runtime.ts`
- Test: `src/lib/agents/runtime.test.ts`

**Interfaces:**
- Consumes: `toolsFor`, `dispatch`, `SERVER_TOOL_NAMES` (Task 3); `AgentSpec`, `AgentContext` (Task 2).
- Produces:
  - `MAX_ITERATIONS = 8`, `DEFAULT_MODEL = "claude-sonnet-4-6"`
  - `interface MessageCreator { messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } }`
  - `interface RunAgentResult { content: string; proposals: ProposedAction[]; stoppedBy: "end" | "max_iterations" }`
  - `runAgent(input: { spec; messages; ctx; client; maxTokens? }): Promise<RunAgentResult>`

The client is injected so tests can stub it — no network in unit tests.

Preserve two behaviours from the routes being replaced:
1. `stop_reason === "pause_turn"` — push the assistant turn and continue with **no** synthetic `tool_result` (`brain/route.ts:131-136`). Server-side `web_search` pauses this way.
2. Server-executed tools never receive a `tool_result`; only locally-owned tool uses do (`brain/route.ts:123-129`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runAgent, MAX_ITERATIONS } from "@/lib/agents/runtime";
import type { AgentSpec, AgentContext } from "@/lib/agents/types";

const spec: AgentSpec = {
  id: "t", name: "T", description: "D", color: "#fff", emoji: "A", vibe: "V",
  surface: "brain", tools: ["crm"], body: "SYSTEM PROMPT",
};

function ctx(): AgentContext {
  return {
    today: "2026-08-13", businessName: "P", founderName: "E", services: "S",
    snapshot: null, proposals: [], emailEnabled: false, calendarEnabled: false,
    driveAccountId: null,
  };
}

const text = (t: string) => ({
  content: [{ type: "text", text: t }], stop_reason: "end_turn",
});
const toolUse = (name: string, id = "tu_1") => ({
  content: [{ type: "tool_use", id, name, input: {} }], stop_reason: "tool_use",
});

function stub(responses: unknown[]) {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  return { client: { messages: { create } } as never, create };
}

describe("runAgent", () => {
  it("returns the text of a single non-tool turn", async () => {
    const { client, create } = stub([text("hello")]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("hello");
    expect(r.stoppedBy).toBe("end");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("passes the agent body as the system prompt", async () => {
    const { client, create } = stub([text("hi")]);
    await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(create.mock.calls[0][0].system).toBe("SYSTEM PROMPT");
  });

  it("uses the spec model override when present", async () => {
    const { client, create } = stub([text("hi")]);
    await runAgent({ spec: { ...spec, model: "claude-opus-4-6" }, messages: [], ctx: ctx(), client });
    expect(create.mock.calls[0][0].model).toBe("claude-opus-4-6");
  });

  it("answers a tool_use with a tool_result and continues", async () => {
    const { client, create } = stub([toolUse("query_leads"), text("done")]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("done");
    const second = create.mock.calls[1][0];
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content[0].type).toBe("tool_result");
  });

  it("does not synthesise a tool_result for a server-executed tool", async () => {
    const { client, create } = stub([
      { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }], stop_reason: "pause_turn" },
      text("researched"),
    ]);
    const r = await runAgent({ spec: { ...spec, tools: ["web"] }, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("researched");
    const second = create.mock.calls[1][0];
    expect(second.messages[second.messages.length - 1].role).toBe("assistant");
  });

  it("stops at the iteration cap and keeps the partial answer", async () => {
    const responses = Array.from({ length: MAX_ITERATIONS }, () => toolUse("query_leads"));
    const { client, create } = stub(responses);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(create).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(r.stoppedBy).toBe("max_iterations");
  });

  it("surfaces a tool failure to the agent instead of throwing", async () => {
    const { client } = stub([toolUse("query_leads"), text("recovered")]);
    // ctx().snapshot is null, so the crm resolver fails inside dispatch
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("recovered");
  });

  it("propagates a model error to the caller", async () => {
    const create = vi.fn().mockRejectedValue(new Error("rate limited"));
    await expect(
      runAgent({ spec, messages: [], ctx: ctx(), client: { messages: { create } } as never }),
    ).rejects.toThrow(/rate limited/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/runtime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/* The agent loop, once. Replaces the copies in the advisor, brain and
   project-chat routes. */

import type Anthropic from "@anthropic-ai/sdk";
import type { ProposedAction } from "@/lib/types";
import { dispatch, toolsFor, SERVER_TOOL_NAMES } from "./capabilities";
import type { AgentContext, AgentSpec } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const MAX_ITERATIONS = 8;
const DEFAULT_MAX_TOKENS = 4096;

/** Minimal surface of the Anthropic client, so tests can stub it. */
export interface MessageCreator {
  messages: {
    create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface RunAgentResult {
  content: string;
  proposals: ProposedAction[];
  stoppedBy: "end" | "max_iterations";
}

export async function runAgent(input: {
  spec: AgentSpec;
  messages: Anthropic.MessageParam[];
  ctx: AgentContext;
  client: MessageCreator;
  maxTokens?: number;
}): Promise<RunAgentResult> {
  const { spec, ctx, client } = input;
  const tools = toolsFor(spec.tools, ctx);
  const messages = [...input.messages];

  let finalText = "";
  let stoppedBy: RunAgentResult["stoppedBy"] = "max_iterations";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: spec.model ?? DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: spec.body,
      tools: tools as unknown as Anthropic.Tool[],
      messages,
    });

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    // A server-executed tool (web_search) pauses the turn. Resume by appending
    // the partial assistant turn with no synthetic tool_result.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const localUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && !SERVER_TOOL_NAMES.has(b.name),
    );

    if (response.stop_reason !== "tool_use" || localUses.length === 0) {
      stoppedBy = "end";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      localUses.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: await dispatch(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx),
      })),
    );
    messages.push({ role: "user", content: results });
  }

  return { content: finalText, proposals: ctx.proposals, stoppedBy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/runtime.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/runtime.ts src/lib/agents/runtime.test.ts
git commit -m "feat(agents): single agent runtime replacing three route loops"
```

---

### Task 7: Migrate existing personas to agent files

**Files:**
- Create: `src/agents/sales-advisor.md`, `src/agents/strategist.md`, `src/agents/product-brainstorm.md`, `src/agents/project-copilot.md`
- Modify: `next.config.ts` — add `outputFileTracingIncludes`
- Test: `src/lib/agents/roster.test.ts`

**Interfaces:**
- Consumes: `loadRegistry`, `listAgents` (Task 5).
- Produces: four agent ids the route migrations in Tasks 11-13 reference by name.

Copy each persona **verbatim** from its current prompt builder so the route migrations are behaviour-preserving and reviewable. Interpolated values (`${founder}`, `${today}`) become literal placeholders `{{founderName}}`, `{{today}}`, `{{businessName}}`, `{{services}}`, substituted by the runtime caller in Task 11.

| File | Source | surface | tools |
| --- | --- | --- | --- |
| `sales-advisor.md` | `advisor/route.ts:51-77` + the email/calendar appendices at `:91-119` | `advisor` | `[crm, projects, email, calendar, writes]` |
| `strategist.md` | `brain/prompt.ts` `strategistPrompt` + `PROJECT_TOOLS_BLOCK` | `brain` | `[projects]` |
| `product-brainstorm.md` | `brain/prompt.ts` `brainstormPrompt` | `brain` | `[projects, drive, web]` |
| `project-copilot.md` | `projects/prompt.ts` `buildProjectSystemPrompt` | `project` | `[projects]` |

Grants match today's behaviour exactly. Task 15 is where `strategist` gets deepened — keeping that separate means Tasks 11-13 can be reviewed as pure refactors.

Example header for `strategist.md`:

```yaml
---
name: The Brain
description: First-principles strategic judgement on irreversible decisions.
color: "#8B5CF6"
emoji: 🧠
vibe: Separates one-way doors from two-way doors, then takes a position.
surface: brain
tools: [projects]
---
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loadRegistry } from "@/lib/agents/registry";
import { CAPABILITY_GROUPS } from "@/lib/agents/types";

describe("the shipped agent roster", () => {
  it("loads every file in src/agents without a validation error", async () => {
    const reg = await loadRegistry();
    expect(reg.size).toBeGreaterThanOrEqual(4);
  });

  it("includes the four migrated personas", async () => {
    const reg = await loadRegistry();
    for (const id of ["sales-advisor", "strategist", "product-brainstorm", "project-copilot"]) {
      expect(reg.has(id)).toBe(true);
    }
  });

  it("grants writes to the advisor only", async () => {
    const reg = await loadRegistry();
    for (const [id, spec] of reg) {
      expect(spec.tools.includes("writes")).toBe(id === "sales-advisor");
    }
  });

  it("declares only known capability groups", async () => {
    const reg = await loadRegistry();
    for (const spec of reg.values()) {
      for (const t of spec.tools) expect(CAPABILITY_GROUPS).toContain(t);
    }
  });

  it("carries a non-trivial system prompt in every agent", async () => {
    const reg = await loadRegistry();
    for (const spec of reg.values()) expect(spec.body.length).toBeGreaterThan(200);
  });
});
```

The third test is the spec's "`writes` off by default" guard, asserted against the **shipped** roster rather than a fixture — a fixture would prove nothing about the files that actually ship.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/roster.test.ts`
Expected: FAIL — registry is empty, `size` is 0.

- [ ] **Step 3: Write the four agent files and the build wiring**

Create each `.md` per the table. Then add to `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The registry reads these at runtime. Without this they exist locally and
  // are absent from the serverless bundle, so the roster is empty in production.
  outputFileTracingIncludes: {
    "/api/**": ["./src/agents/**"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agents/roster.test.ts && npx tsc --noEmit`
Expected: PASS, 5 tests; clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/agents next.config.ts src/lib/agents/roster.test.ts
git commit -m "feat(agents): migrate existing personas to agent files"
```

---

### Task 8: Roster API route

**Files:**
- Create: `src/app/api/agents/route.ts`
- Test: `src/app/api/agents/route.test.ts`

**Interfaces:**
- Consumes: `listAgents` (Task 5), `AGENT_SURFACES` (Task 2).
- Produces: `GET /api/agents?surface=<surface>` → `{ agents: AgentCard[] }`; 400 on an unknown surface.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/agents/route";

const call = (url: string) => GET(new Request(url));

describe("GET /api/agents", () => {
  it("returns the cards for a surface", async () => {
    const res = await call("http://x/api/agents?surface=brain");
    expect(res.status).toBe(200);
    const { agents } = await res.json();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("emoji");
  });

  it("never leaks the system prompt or the tool grant", async () => {
    const { agents } = await (await call("http://x/api/agents?surface=brain")).json();
    for (const a of agents) {
      expect(Object.keys(a).sort())
        .toEqual(["color", "description", "emoji", "id", "name", "vibe"]);
    }
  });

  it("rejects an unknown surface", async () => {
    expect((await call("http://x/api/agents?surface=nope")).status).toBe(400);
  });

  it("rejects a missing surface", async () => {
    expect((await call("http://x/api/agents")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/agents/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { listAgents } from "@/lib/agents/registry";
import { AGENT_SURFACES, type AgentSurface } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const surface = new URL(req.url).searchParams.get("surface") ?? "";
  if (!(AGENT_SURFACES as readonly string[]).includes(surface)) {
    return NextResponse.json({ error: "bad_surface" }, { status: 400 });
  }
  try {
    return NextResponse.json({ agents: await listAgents(surface as AgentSurface) });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/agents/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/route.ts src/app/api/agents/route.test.ts
git commit -m "feat(agents): roster endpoint"
```

---

### Task 9: Extract the tomorrow plan to deterministic code

**Files:**
- Create: `src/lib/plan/tomorrow.ts`, `src/lib/plan/tomorrow.test.ts`
- Modify: `src/lib/ai.ts` — remove `generateTomorrowPlan`
- Modify: any caller found by `grep -rn "generateTomorrowPlan" src`

`generateTomorrowPlan` is not AI and never was: it ranks open tasks, due follow-ups and the latest scorecard with `if` statements. It moves out of the mock so that deleting the mock in Task 10 removes only fake AI.

**Interfaces:**
- Produces: `tomorrowPlan(input: { scorecard: Scorecard | null; openTasks: Task[]; dueFollowUps: number }): { priorities: string[]; outreachFocus: string; buildFocus: string }` — identical shape to the function it replaces.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { tomorrowPlan } from "@/lib/plan/tomorrow";
import type { Task } from "@/lib/types";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1", title: "Ship the thing", category: "delivery", priority: "high",
  status: "not started", dueDate: "2026-08-14", notes: "", linkKind: "none",
  linkId: null, milestoneId: null, createdAt: "", updatedAt: "", ...over,
});

describe("tomorrowPlan", () => {
  it("leads with due follow-ups when there are any", () => {
    const p = tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 3 });
    expect(p.priorities[0]).toMatch(/3 follow-ups/);
  });

  it("singularises a single follow-up", () => {
    const p = tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 1 });
    expect(p.priorities[0]).toMatch(/1 follow-up\b/);
    expect(p.priorities[0]).not.toMatch(/follow-ups/);
  });

  it("surfaces the earliest-due high-priority open task", () => {
    const p = tomorrowPlan({
      scorecard: null, dueFollowUps: 0,
      openTasks: [task({ id: "a", title: "Later", dueDate: "2026-09-01" }),
                  task({ id: "b", title: "Sooner", dueDate: "2026-08-14" })],
    });
    expect(p.priorities.some((s) => s.includes("Sooner"))).toBe(true);
  });

  it("ignores done tasks", () => {
    const p = tomorrowPlan({
      scorecard: null, dueFollowUps: 0,
      openTasks: [task({ title: "Finished", status: "done" })],
    });
    expect(p.priorities.some((s) => s.includes("Finished"))).toBe(false);
  });

  it("always returns exactly three priorities", () => {
    expect(tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 0 }).priorities).toHaveLength(3);
    expect(tomorrowPlan({ scorecard: null, openTasks: [task()], dueFollowUps: 5 }).priorities).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/plan/tomorrow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the implementation**

Create `src/lib/plan/tomorrow.ts` with the body of `generateTomorrowPlan` from `src/lib/ai.ts:209-249`, renamed to `tomorrowPlan`, plus the `shorten` helper it depends on (`ai.ts:270-273`). Add a header comment stating it is deterministic ranking, not a model call. Delete `generateTomorrowPlan` from `src/lib/ai.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS; clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan src/lib/ai.ts
git commit -m "refactor(plan): tomorrow plan is deterministic ranking, not AI"
```

---

### Task 10: Delete the mock and make the two generators real

**Files:**
- Delete: `src/lib/ai.ts`
- Modify: `src/lib/aiClient.ts` — remove the silent fallback
- Modify: `src/app/api/ai/route.ts` — confirm `callSummary` and `businessReview` kinds are schema-constrained
- Modify: `src/app/interactions/page.tsx`, `src/app/review/page.tsx` — render the failure state
- Create: `src/lib/agents/noMock.test.ts` — regression guard

**Interfaces:**
- Produces: `requestCallSummary(...)` and `requestBusinessReview(...)` now **reject** on failure rather than returning mock data. Callers must handle the rejection.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("the mock AI layer stays deleted", () => {
  it("src/lib/ai.ts does not exist", () => {
    expect(existsSync(join(process.cwd(), "src", "lib", "ai.ts"))).toBe(false);
  });

  it("nothing imports @/lib/ai", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /from\s+["']@\/lib\/ai["']|from\s+["']\.\/ai["']|from\s+["']\.\.\/ai["']/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it("aiClient has no silent fallback", () => {
    const s = readFileSync(join(process.cwd(), "src", "lib", "aiClient.ts"), "utf8");
    expect(s).not.toMatch(/fall through to mock/i);
    expect(s).not.toMatch(/generateCallSummary|generateBusinessReview/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/noMock.test.ts`
Expected: FAIL — all three assertions fail; `src/lib/ai.ts` still exists.

- [ ] **Step 3: Delete the mock and rewrite the client**

Rewrite `src/lib/aiClient.ts` so each function throws a typed error instead of falling back:

```ts
"use client";

import type { BusinessReview, CallSummary } from "./types";

export class AIUnavailable extends Error {
  constructor(public code: "no_key" | "failed", message: string) { super(message); }
}

async function post<T>(kind: string, input: unknown, context?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, input, context }),
    });
  } catch (err) {
    throw new AIUnavailable("failed", (err as Error).message);
  }
  if (res.status === 503) throw new AIUnavailable("no_key", "No model configured");
  if (!res.ok) throw new AIUnavailable("failed", `Model request failed (${res.status})`);
  const data = await res.json();
  if (!data?.result) throw new AIUnavailable("failed", "Model returned no result");
  return data.result as T;
}

export async function requestCallSummary(input: {
  rawNotes: string; whatTheySaid?: string; painPoints?: string; objections?: string;
  buyingSignals?: string; company?: string; contact?: string;
  context?: { businessName?: string; services?: string };
}): Promise<CallSummary> {
  return post<CallSummary>("callSummary", input, input.context);
}

export async function requestBusinessReview(
  text: string,
  context?: { businessName?: string; services?: string },
): Promise<BusinessReview> {
  return post<BusinessReview>("businessReview", { text }, context);
}
```

Keep `aiStatus()` unchanged.

Then `rm src/lib/ai.ts`, and in both `src/app/interactions/page.tsx` and `src/app/review/page.tsx` wrap the call in `try/catch`, storing an error message in state and rendering it where the result would go. Use the existing error-banner styling on those pages; if none exists, a `<p className="text-[var(--color-danger)]">` line is sufficient.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS; clean typecheck. `src/lib/advisor/tools.test.ts` may need its `generate_call_summary` assertion removed — Task 3 already dropped the tool.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/aiClient.ts src/lib/agents/noMock.test.ts src/app/interactions/page.tsx src/app/review/page.tsx
git rm src/lib/ai.ts
git commit -m "fix(ai): delete the mock layer; failures no longer render as answers"
```

---

### Task 11: Migrate the Brain route onto the runtime

**Files:**
- Modify: `src/app/api/brain/route.ts`
- Create: `src/lib/agents/render.ts`, `src/lib/agents/render.test.ts`
- Delete: `src/lib/brain/prompt.ts` and `src/lib/brain/prompt.test.ts` (persona now lives in `src/agents/`); keep `formatAttachmentsBlock` by moving it to `src/lib/brain/attachments.ts` with its tests

**Interfaces:**
- Consumes: `getAgent` (Task 5), `runAgent` (Task 6).
- Produces: `renderBody(body: string, ctx: AgentContext): string` — substitutes `{{today}}`, `{{businessName}}`, `{{founderName}}`, `{{services}}`.

Brain goes first because it is the smallest loop and the surface whose starvation motivated the work.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderBody } from "@/lib/agents/render";
import type { AgentContext } from "@/lib/agents/types";

const ctx: AgentContext = {
  today: "2026-08-13", businessName: "Pallisade Data", founderName: "Emil",
  services: "AI systems", snapshot: null, proposals: [],
  emailEnabled: false, calendarEnabled: false, driveAccountId: null,
};

describe("renderBody", () => {
  it("substitutes every known placeholder", () => {
    expect(renderBody("{{today}} {{businessName}} {{founderName}} {{services}}", ctx))
      .toBe("2026-08-13 Pallisade Data Emil AI systems");
  });

  it("substitutes a placeholder used more than once", () => {
    expect(renderBody("{{founderName}} and {{founderName}}", ctx)).toBe("Emil and Emil");
  });

  it("leaves an unknown placeholder untouched rather than blanking it", () => {
    expect(renderBody("{{nope}}", ctx)).toBe("{{nope}}");
  });

  it("returns a body with no placeholders unchanged", () => {
    expect(renderBody("plain text", ctx)).toBe("plain text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `render.ts`, then rewrite the route**

```ts
import type { AgentContext } from "./types";

const KEYS = ["today", "businessName", "founderName", "services"] as const;

/** Substitutes {{placeholder}} tokens. Unknown tokens are left in place so a
 *  typo is visible in the output rather than silently blanking the prompt. */
export function renderBody(body: string, ctx: AgentContext): string {
  let out = body;
  for (const k of KEYS) out = out.split(`{{${k}}}`).join(String(ctx[k]));
  return out;
}
```

Rewrite `src/app/api/brain/route.ts` to roughly:

```ts
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError("agent_unconfigured", 503);

  let body: BrainRequest;
  try { body = await req.json(); } catch { return apiError("bad_request", 400); }

  // `mode` is still accepted so existing clients keep working: strategist and
  // brainstorm are now two agents rather than two branches.
  const agentId = body.agentId ?? (body.mode === "brainstorm" ? "product-brainstorm" : "strategist");

  let spec: AgentSpec;
  try { spec = await getAgent(agentId); }
  catch { return apiError("agent_not_found", 404); }

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || DEFAULT_SERVICES,
    snapshot: body.snapshot ?? null,
    proposals: [],
    emailEnabled: await emailToolsAvailable(),
    calendarEnabled: await calendarToolsAvailable(),
    driveAccountId: body.context?.driveAccountId ?? null,
  };

  let rendered = renderBody(spec.body, ctx);
  const attachments = formatAttachmentsBlock(body.attachments ?? []);
  if (attachments) rendered += `\n\n${attachments}`;

  try {
    const result = await runAgent({
      spec: { ...spec, body: rendered },
      messages: (body.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
      ctx,
      client: new Anthropic({ apiKey }),
    });
    return NextResponse.json({
      content: result.content || "I couldn't produce a response — try rephrasing.",
      stoppedBy: result.stoppedBy,
    });
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS; clean typecheck. Update `src/lib/brain/prompt.test.ts` — it moves to `attachments.test.ts` covering only `formatAttachmentsBlock`.

- [ ] **Step 5: Commit**

```bash
git add -A src/app/api/brain src/lib/agents/render.ts src/lib/agents/render.test.ts src/lib/brain
git commit -m "refactor(brain): run the Brain on the agent runtime"
```

---

### Task 12: Migrate the Advisor route onto the runtime

**Files:**
- Modify: `src/app/api/advisor/route.ts`

Same shape as Task 11, with three differences: `agentId` defaults to `"sales-advisor"`; the response keeps `actions: result.proposals`; and `maxTokens: 2048` preserves the advisor's current budget.

The email and calendar system-prompt appendices (`advisor/route.ts:91-119`) moved into `sales-advisor.md` in Task 7. They are unconditional in the file, while the tools remain conditional via `ctx.emailEnabled` / `ctx.calendarEnabled`. That is acceptable: the prompt describes tools the agent may not have, which it discovers by not being offered them. If this proves confusing in use, gate the appendices with placeholders in a follow-up — do not add branching to the route.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("advisor route", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/advisor/route.ts"), "utf8");

  it("no longer contains its own tool-use loop", () => {
    expect(src).not.toMatch(/MAX_ITERATIONS/);
    expect(src).not.toMatch(/stop_reason/);
  });

  it("delegates to the agent runtime", () => {
    expect(src).toMatch(/runAgent/);
  });

  it("still returns queued proposals to the client", () => {
    expect(src).toMatch(/actions/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/advisor`
Expected: FAIL — the loop is still inline.

- [ ] **Step 3: Rewrite the route**

Mirror Task 11's structure. Keep the `missing_snapshot` 400 guard — the CRM read tools need it. Return `{ content, actions: result.proposals, stoppedBy: result.stoppedBy }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS; clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/advisor
git commit -m "refactor(advisor): run the Sales Advisor on the agent runtime"
```

---

### Task 13: Migrate the Projects chat route onto the runtime

**Files:**
- Modify: `src/app/api/projects/chat/route.ts`
- Modify: `src/lib/projects/prompt.ts` — persona moves to `project-copilot.md`; keep any snapshot-formatting helpers

`projects/chat` differs in that its system prompt embeds a per-project snapshot. Append that snapshot to the rendered body exactly as Task 11 appends attachments, rather than adding a branch to the runtime.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("projects chat route", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/projects/chat/route.ts"), "utf8");

  it("no longer contains its own tool-use loop", () => {
    expect(src).not.toMatch(/MAX_ITERATIONS/);
    expect(src).not.toMatch(/stop_reason/);
  });

  it("delegates to the agent runtime", () => {
    expect(src).toMatch(/runAgent/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/projects`
Expected: FAIL.

- [ ] **Step 3: Rewrite the route**

Resolve `project-copilot`, render the body, append the project snapshot block, call `runAgent` with `maxTokens: 2048`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS. The three duplicated loops are now gone; confirm with
`grep -rn "MAX_ITERATIONS" src/app` returning nothing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects src/lib/projects/prompt.ts
git commit -m "refactor(projects): run project chat on the agent runtime"
```

---

### Task 14: Brain roster picker

**Files:**
- Modify: `src/app/brain/page.tsx`
- Create: `src/components/agents/AgentPicker.tsx`
- Modify: `src/lib/brainClient.ts` — send `agentId`

**Interfaces:**
- Consumes: `GET /api/agents?surface=brain` (Task 8).
- Produces: `<AgentPicker surface="brain" value={id} onChange={setId} />`, reusable by any surface.

Render each agent as a selectable chip: `emoji`, `name`, `color` as the active border/background tint, `vibe` as the title attribute. Persist the selection in `localStorage` keyed by surface so the founder's choice survives a reload. Replace the existing strategist/brainstorm mode toggle with the picker — those are now two agents.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("brain client", () => {
  it("sends an agentId to the brain route", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/brainClient.ts"), "utf8");
    expect(src).toMatch(/agentId/);
  });
});
```

Component rendering is verified in the browser at Task 17 — the suite is `environment: "node"` with no DOM testing library, and adding one is out of scope.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brainClient.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build the picker and wire it up**

Follow the existing chip/badge styling in `src/components/ui/Badge.tsx`. Fetch the roster once on mount; show nothing while loading rather than a spinner, since the list is small and local.

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean typecheck, successful production build.

- [ ] **Step 5: Commit**

```bash
git add src/app/brain src/components/agents src/lib/brainClient.ts
git commit -m "feat(brain): agent picker replaces the mode toggle"
```

---

### Task 15: Deepen the Brain and add the bench

**Files:**
- Modify: `src/agents/strategist.md` — widen the tool grant
- Create: `src/agents/deal-strategist.md`, `src/agents/discovery-coach.md`, `src/agents/pipeline-analyst.md`
- Modify: `src/lib/agents/roster.test.ts`

This is the task that answers "the Brain is very underdeveloped". `strategist.md` goes from `tools: [projects]` to `tools: [crm, projects, drive, email, calendar, web]` — it can now see leads, interactions, quotes, the pipeline and the inbox.

Adapt the three new personas from `agency-agents`, rewriting each against Pallisade's real domain rather than importing verbatim:

| File | Upstream source | tools |
| --- | --- | --- |
| `deal-strategist.md` | `sales/sales-deal-strategist.md` | `[crm, projects, email, calendar]` |
| `discovery-coach.md` | `sales/sales-discovery-coach.md` | `[crm, calendar]` |
| `pipeline-analyst.md` | `sales/sales-pipeline-analyst.md` | `[crm, email]` |

Fetch with `curl -sL https://raw.githubusercontent.com/msitarzewski/agency-agents/main/<path>`. For each, keep the framework content (SPIN, Gap Selling, MEDDIC and similar) and replace the generic agency framing with Pallisade's: a solo B2B agency selling bespoke AI systems to boutique asset managers, whose data lives in the CRM tools the agent can call. Every persona must instruct the agent to ground claims in tool output and never invent leads, numbers or history — matching the rule already in `sales-advisor.md`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to src/lib/agents/roster.test.ts
it("gives the Brain strategist real access to the business", async () => {
  const spec = (await loadRegistry()).get("strategist")!;
  for (const g of ["crm", "projects", "email", "calendar", "drive", "web"]) {
    expect(spec.tools).toContain(g);
  }
});

it("puts a bench of specialists on the brain surface", async () => {
  const brain = [...(await loadRegistry()).values()].filter((s) => s.surface === "brain");
  expect(brain.length).toBeGreaterThanOrEqual(5);
});

it("still grants writes to the advisor only", async () => {
  for (const [id, spec] of await loadRegistry()) {
    expect(spec.tools.includes("writes")).toBe(id === "sales-advisor");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agents/roster.test.ts`
Expected: FAIL — strategist has only `projects`; brain surface has 2 agents.

- [ ] **Step 3: Write the agent files**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents src/lib/agents/roster.test.ts
git commit -m "feat(agents): deepen the Brain and add the specialist bench"
```

---

### Task 16: Settings agent editor

**Files:**
- Create: `src/app/api/agents/[id]/route.ts` (PUT saves an override, DELETE clears it)
- Modify: `src/app/settings/page.tsx`
- Test: `src/app/api/agents/[id]/route.test.ts`

**Interfaces:**
- Consumes: `saveOverride`, `clearOverride` (Task 4); `resetRegistryCache`, `getAgent` (Task 5).
- Produces: `PUT /api/agents/:id { body }` → 200; `DELETE /api/agents/:id` → 200; both 404 on an unknown id.

Both handlers must call `resetRegistryCache()` after writing, or the running process keeps serving the cached body.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PUT, DELETE } from "@/app/api/agents/[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("agent override endpoints", () => {
  it("saves an override for a known agent", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "custom" }) });
    expect((await PUT(req, params("strategist"))).status).toBe(200);
  });

  it("rejects an unknown agent", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "x" }) });
    expect((await PUT(req, params("nope"))).status).toBe(404);
  });

  it("rejects an empty body", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "  " }) });
    expect((await PUT(req, params("strategist"))).status).toBe(400);
  });

  it("clears an override", async () => {
    expect((await DELETE(new Request("http://x"), params("strategist"))).status).toBe(200);
  });
});
```

Clean up written overrides in an `afterEach` so the roster tests stay deterministic.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/agents`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route and the Settings panel**

The Settings panel lists every agent grouped by surface, shows `emoji`/`name`/`description`, and offers a textarea bound to the body with **Save** and **Reset to default**. Show the tool grant read-only, with a line stating grants are file-owned and not editable here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, clean typecheck, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents src/app/settings
git commit -m "feat(agents): edit and reset agent personas in Settings"
```

---

### Task 17: Mutation sweep and live verification

**Files:**
- Create: `scripts/mutate.sh`
- Modify: `docs/superpowers/plans/2026-08-13-agent-registry-tool-bus-STATUS.md` (create)

**Interfaces:** none — this is the gate before calling the work done.

- [ ] **Step 1: Write the mutation harness**

```bash
#!/usr/bin/env bash
# Apply a find/replace to a source file, run that file's tests, report whether
# a test died. A surviving mutant means the check never fired.
#   ./scripts/mutate.sh src/lib/agents/spec.ts 'CAPABILITY_GROUPS' 'AGENT_SURFACES'
set -euo pipefail
FILE=$1; FIND=$2; REPLACE=$3
TEST="${FILE%.ts}.test.ts"
cp "$FILE" "$FILE.bak"
trap 'mv "$FILE.bak" "$FILE"' EXIT
perl -pi -e "s/\Q$FIND\E/$REPLACE/g" "$FILE"
if npx vitest run "$TEST" >/dev/null 2>&1; then
  echo "SURVIVED: $FIND -> $REPLACE in $FILE"; exit 1
else
  echo "killed:   $FIND -> $REPLACE in $FILE"
fi
```

- [ ] **Step 2: Run the sweep**

Run at least these mutants against `spec.ts`, `capabilities.ts` and `runtime.ts`:

```bash
./scripts/mutate.sh src/lib/agents/spec.ts '!(AGENT_SURFACES as readonly string[]).includes' '(AGENT_SURFACES as readonly string[]).includes'
./scripts/mutate.sh src/lib/agents/spec.ts 'if (!body.trim())' 'if (false)'
./scripts/mutate.sh src/lib/agents/capabilities.ts 'ctx.emailEnabled ? EMAIL_TOOLS : []' 'EMAIL_TOOLS'
./scripts/mutate.sh src/lib/agents/capabilities.ts 'case "writes": return WRITE_TOOLS_DEFS;' 'case "writes": return [];'
./scripts/mutate.sh src/lib/agents/runtime.ts 'i < MAX_ITERATIONS' 'i < MAX_ITERATIONS + 1'
./scripts/mutate.sh src/lib/agents/runtime.ts '!SERVER_TOOL_NAMES.has(b.name)' 'true'
```

Expected: every one reports `killed`. Any `SURVIVED` line means a test asserts something it cannot detect — fix the test, then re-run.

- [ ] **Step 3: Live verification in the browser**

`STATUS.md` for the content engine has an open item from 2026-08-05 because this step was deferred. Do not defer it.

```bash
npm run dev
```

Then confirm each of these by hand:
1. `/brain` shows the picker with at least five agents, each with its emoji and colour.
2. Selecting **The Brain** and asking "what's in my pipeline right now?" returns an answer grounded in real leads — proving the widened tool grant works.
3. Selecting **Product Brainstorm** and asking a question that needs research triggers `web_search` and returns without hanging — proving `pause_turn` handling survived the extraction.
4. `/advisor` still queues a write proposal and still requires confirmation before it applies.
5. Unset `ANTHROPIC_API_KEY`, restart, and confirm `/brain` and `/interactions` show a clear "no model configured" state rather than plausible-looking output.
6. Edit `strategist`'s body in Settings, save, ask a question, and confirm the edit took effect. Then **Reset to default** and confirm it reverts.

- [ ] **Step 4: Verify the whole suite and a production build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS (824 baseline plus roughly 60 new), clean typecheck, successful build.

- [ ] **Step 5: Write the status doc and commit**

Record: final test count, which mutants were run, what the live runs found, and anything deliberately left. Follow the format of `2026-08-04-content-studio-daily-engine-STATUS.md`.

```bash
git add scripts/mutate.sh docs/superpowers/plans/2026-08-13-agent-registry-tool-bus-STATUS.md
git commit -m "test(agents): mutation sweep and live verification"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: agent file format → 1, 2, 7; capability groups → 3; components → 1-6; data flow → 5, 6, 8, 11-13; disposition of the mock → 9, 10; error handling → 10, 11; testing → every task plus 17; roster → 8, 14, 15; overrides → 4, 16; build wiring → 7. The `repo` and `fathom` groups are specified as names with empty grants in Task 3, matching the spec's statement that their implementations are follow-up specs.

**Deliberate omissions.** Meeting Prep and Business Review are not migrated — the spec excludes both as one-shot generators. Business Review is still touched in Task 10 because its mock dies there.

**Known risk.** Task 12 moves the advisor's conditional email and calendar prompt appendices into an unconditional agent file. The tools stay conditional, so the agent may be told about tools it is not offered. This is called out in the task with the reason not to reintroduce branching.

**Type consistency check.** `AgentSpec`, `AgentCard`, `AgentContext`, `CapabilityGroup` and `AgentSurface` are defined once in Task 2 and used unchanged after. `toolsFor`/`dispatch` signatures in Task 3 match their calls in Task 6. `runAgent`'s return shape in Task 6 matches its use in Tasks 11-13. `tomorrowPlan` in Task 9 keeps the exact shape of the `generateTomorrowPlan` it replaces.
