# Sales Advisor Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agentic "Sales Advisor" chat at `/advisor` that reads all Pallisade OS data, runs the existing AI skills, and proposes data-changing actions behind explicit confirmation.

**Architecture:** A new `/advisor` page sends the thread + a snapshot of current app data to `POST /api/advisor`, which runs a Claude (Sonnet 4.6) tool-use loop. Read/skill tools resolve inline against the snapshot; write tools never mutate on the server — they are returned as `ProposedAction`s, applied client-side through the existing store CRUD after the user clicks Confirm. Conversations persist as a normal collection in the existing blob store.

**Tech Stack:** Next.js 15 (App Router), TypeScript, `@anthropic-ai/sdk`, Tailwind v4 design tokens, lucide-react, Vitest (new, dev-only) for the pure logic.

---

## Pre-flight (one-time)

This folder is **not** a git repo. The commit steps below assume git. Run once before Task 1:

```bash
cd "/Users/emilfabel/Desktop/Pallisade_OS"
git init && git add -A && git commit -m "chore: baseline before sales advisor"
```

If you prefer not to use git, simply skip every "Commit" step.

---

## File Structure

**New files:**
- `vitest.config.ts` — test runner config with the `@/` alias.
- `src/lib/advisor/readTools.ts` — pure read-tool resolvers over a snapshot.
- `src/lib/advisor/applyAction.ts` — client-safe: builds full entity records from action args and applies them via store CRUD.
- `src/lib/advisor/tools.ts` — server: Anthropic tool schemas, skill-tool resolvers, `describeAction`, and the `resolveTool` dispatcher.
- `src/lib/advisorClient.ts` — client gateway: `getAdvisorStatus`, `sendAdvisorTurn`, `buildSnapshot`.
- `src/app/api/advisor/route.ts` — the tool-use loop endpoint.
- `src/app/advisor/page.tsx` — the chat page.
- `src/components/advisor/ThreadList.tsx`, `MessageBubble.tsx`, `ActionCard.tsx` — presentational pieces.
- Test files: `src/lib/advisor/readTools.test.ts`, `src/lib/advisor/applyAction.test.ts`, `src/lib/advisor/tools.test.ts`.

**Modified files:**
- `src/lib/types.ts` — add `ProposedAction`, `ChatMessage`, `Conversation`, `AdvisorSnapshot`; add `conversations` to `DataShape`.
- `src/lib/store.tsx` — add `conversations: []` to `EMPTY`.
- `src/lib/seed.ts` — add `conversations: []` to the returned `DataShape`.
- `src/components/layout/nav.ts` — add the `/advisor` nav entry.
- `package.json` — add `vitest` dev dependency + `test` script.

---

## Task 1: Set up Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/advisor/sanity.test.ts` (temporary)

- [ ] **Step 1: Install Vitest**

Run: `npm i -D vitest@^3`
Expected: adds `vitest` to devDependencies (network required).

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write a sanity test**

Create `src/lib/advisor/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Delete the sanity test and commit**

```bash
rm src/lib/advisor/sanity.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest harness"
```

---

## Task 2: Data model — conversations collection

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/store.tsx`
- Modify: `src/lib/seed.ts`

- [ ] **Step 1: Add chat types to `src/lib/types.ts`**

Add after the `BusinessReview` interface (before `Settings`):

```ts
/* ---------- sales advisor chat ---------- */

export interface ProposedAction {
  id: string;
  tool: string;                       // e.g. "create_task"
  description: string;                // human-readable, shown on the card
  args: Record<string, unknown>;
  status: "pending" | "confirmed" | "dismissed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];         // assistant turns only
  createdAt: string;                  // ISO
}

export interface Conversation extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  messages: ChatMessage[];
}
```

- [ ] **Step 2: Register the collection in `DataShape`**

In `src/lib/types.ts`, change the `DataShape` interface to add `conversations`:

```ts
export interface DataShape {
  leads: Lead[];
  interactions: Interaction[];
  projects: Project[];
  tasks: Task[];
  scorecards: Scorecard[];
  painPoints: PainPoint[];
  conversations: Conversation[];
  settings: Settings;
}
```

- [ ] **Step 3: Add the snapshot type**

At the end of `src/lib/types.ts`, after the `CollectionKey` line, add:

```ts
/** What the Sales Advisor route receives as the current data picture. */
export type AdvisorSnapshot = Omit<DataShape, "conversations">;
```

- [ ] **Step 4: Add `conversations: []` to `EMPTY` in `src/lib/store.tsx`**

In the `EMPTY` object literal:

```ts
const EMPTY: DataShape = {
  leads: [],
  interactions: [],
  projects: [],
  tasks: [],
  scorecards: [],
  painPoints: [],
  conversations: [],
  settings: DEFAULT_SETTINGS,
};
```

- [ ] **Step 5: Add `conversations: []` to the seed in `src/lib/seed.ts`**

In the final `return { ... }` of `seedData` (the one listing `leads, interactions, …`):

```ts
  return {
    leads,
    interactions,
    projects,
    tasks,
    scorecards,
    painPoints,
    conversations: [],
    settings: DEFAULT_SETTINGS,
  };
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (conversations now satisfies `DataShape` everywhere it's constructed).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/seed.ts
git commit -m "feat: add conversations data model"
```

---

## Task 3: Read-tool resolvers (pure)

**Files:**
- Create: `src/lib/advisor/readTools.ts`
- Test: `src/lib/advisor/readTools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/readTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { queryLeads, queryTasks, getPipelineMetrics } from "@/lib/advisor/readTools";
import type { AdvisorSnapshot } from "@/lib/types";

function emptySnapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
    },
  };
}

const base = { id: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("queryLeads", () => {
  it("filters by status and trims to compact shape", () => {
    const snap = emptySnapshot();
    snap.leads = [
      { ...base, id: "l1", company: "Acme", contactName: "Jo", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "Finance", companyType: "", source: "referral", status: "interested",
        quality: "high", painPoint: "manual reports", objection: "", buyingSignal: "", lastContact: null,
        nextFollowUp: "2026-06-12", notes: "", solutionIdea: "", estimatedValue: 5000, owner: "" },
      { ...base, id: "l2", company: "Beta", contactName: "", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "", companyType: "", source: "cold call", status: "lost",
        quality: "low", painPoint: "", objection: "", buyingSignal: "", lastContact: null,
        nextFollowUp: null, notes: "", solutionIdea: "", estimatedValue: 0, owner: "" },
    ];
    const out = queryLeads(snap, { status: "interested" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "l1", company: "Acme", status: "interested" });
    expect(out[0]).not.toHaveProperty("notes"); // compact shape drops bulky fields
  });

  it("filters by hasFollowUp", () => {
    const snap = emptySnapshot();
    snap.leads = [
      { ...base, id: "l1", company: "Acme", contactName: "", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "", companyType: "", source: "referral", status: "new", quality: "high",
        painPoint: "", objection: "", buyingSignal: "", lastContact: null, nextFollowUp: "2026-06-12",
        notes: "", solutionIdea: "", estimatedValue: 0, owner: "" },
    ];
    expect(queryLeads(snap, { hasFollowUp: true })).toHaveLength(1);
    expect(queryLeads({ ...snap, leads: [{ ...snap.leads[0], nextFollowUp: null }] }, { hasFollowUp: true })).toHaveLength(0);
  });
});

describe("queryTasks", () => {
  it("filters by status", () => {
    const snap = emptySnapshot();
    snap.tasks = [
      { ...base, id: "t1", title: "Call Acme", linkKind: "none", linkId: null, category: "follow-up",
        priority: "high", status: "not started", dueDate: "2026-06-12", notes: "" },
      { ...base, id: "t2", title: "Done thing", linkKind: "none", linkId: null, category: "admin",
        priority: "low", status: "done", dueDate: null, notes: "" },
    ];
    const out = queryTasks(snap, { status: "not started" });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Call Acme");
  });
});

describe("getPipelineMetrics", () => {
  it("returns counts and value", () => {
    const snap = emptySnapshot();
    const m = getPipelineMetrics(snap, {});
    expect(m).toHaveProperty("pipelineValue");
    expect(m).toHaveProperty("statusCounts");
    expect(Array.isArray(m.statusCounts)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/advisor/readTools.test.ts`
Expected: FAIL — cannot find module `@/lib/advisor/readTools`.

- [ ] **Step 3: Implement `src/lib/advisor/readTools.ts`**

```ts
import type {
  AdvisorSnapshot, Lead, Task, Project, Interaction, PainPoint,
} from "@/lib/types";
import {
  pipelineCounts, pipelineValue, dashboardMetrics, followUps,
} from "@/lib/selectors";

/* ---------- compact projections (keep tool results small) ---------- */

const compactLead = (l: Lead) => ({
  id: l.id, company: l.company, contact: l.contactName, status: l.status,
  quality: l.quality, source: l.source, industry: l.industry,
  nextFollowUp: l.nextFollowUp, lastContact: l.lastContact,
  estimatedValue: l.estimatedValue, painPoint: l.painPoint, buyingSignal: l.buyingSignal,
});
const compactTask = (t: Task) => ({
  id: t.id, title: t.title, status: t.status, category: t.category,
  priority: t.priority, dueDate: t.dueDate, linkKind: t.linkKind, linkId: t.linkId,
});
const compactProject = (p: Project) => ({
  id: p.id, name: p.name, company: p.company, type: p.type, stage: p.stage,
  priority: p.priority, dueDate: p.dueDate, nextAction: p.nextAction, currentBlocker: p.currentBlocker,
});
const compactInteraction = (it: Interaction) => ({
  id: it.id, leadId: it.leadId, company: it.company, contact: it.contact,
  date: it.date, type: it.type, painPoints: it.painPoints, buyingSignals: it.buyingSignals,
});
const compactPain = (p: PainPoint) => ({
  id: p.id, painPoint: p.painPoint, industry: p.industry, urgency: p.urgency,
  frequency: p.frequency, possibleSolution: p.possibleSolution,
});

const lc = (v: unknown) => String(v ?? "").toLowerCase();

/* ---------- resolvers ---------- */

export function queryLeads(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.leads;
  if (a.status) out = out.filter((l) => l.status === a.status);
  if (a.quality) out = out.filter((l) => l.quality === a.quality);
  if (a.source) out = out.filter((l) => l.source === a.source);
  if (a.industry) out = out.filter((l) => lc(l.industry).includes(lc(a.industry)));
  if (a.hasFollowUp) out = out.filter((l) => !!l.nextFollowUp);
  return out.slice(0, Number(a.limit) || 25).map(compactLead);
}

export function queryTasks(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.tasks;
  if (a.status) out = out.filter((t) => t.status === a.status);
  if (a.category) out = out.filter((t) => t.category === a.category);
  if (a.priority) out = out.filter((t) => t.priority === a.priority);
  return out.slice(0, Number(a.limit) || 30).map(compactTask);
}

export function queryProjects(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.projects;
  if (a.stage) out = out.filter((p) => p.stage === a.stage);
  if (a.type) out = out.filter((p) => p.type === a.type);
  if (a.priority) out = out.filter((p) => p.priority === a.priority);
  return out.slice(0, Number(a.limit) || 30).map(compactProject);
}

export function queryInteractions(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.interactions;
  if (a.leadId) out = out.filter((it) => it.leadId === a.leadId);
  if (a.type) out = out.filter((it) => it.type === a.type);
  if (a.company) out = out.filter((it) => lc(it.company).includes(lc(a.company)));
  return out
    .slice()
    .sort((x, y) => String(y.date).localeCompare(String(x.date)))
    .slice(0, Number(a.limit) || 20)
    .map(compactInteraction);
}

export function searchPainPoints(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.painPoints;
  if (a.query) out = out.filter((p) => lc(p.painPoint).includes(lc(a.query)) || lc(p.possibleSolution).includes(lc(a.query)));
  if (a.industry) out = out.filter((p) => lc(p.industry).includes(lc(a.industry)));
  if (a.urgency) out = out.filter((p) => p.urgency === a.urgency);
  return out.slice(0, Number(a.limit) || 25).map(compactPain);
}

export function getPipelineMetrics(s: AdvisorSnapshot, _a: Record<string, unknown>) {
  return {
    metrics: dashboardMetrics(s.leads, s.projects, s.tasks, s.scorecards),
    statusCounts: pipelineCounts(s.leads),
    pipelineValue: pipelineValue(s.leads),
    followUpsDue: followUps(s.leads, s.tasks).map((f) => ({
      title: f.title, subtitle: f.subtitle, date: f.date, overdue: f.overdue, kind: f.kind,
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/advisor/readTools.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/advisor/readTools.ts src/lib/advisor/readTools.test.ts
git commit -m "feat: advisor read-tool resolvers"
```

---

## Task 4: Action builders + applier (client)

**Files:**
- Create: `src/lib/advisor/applyAction.ts`
- Test: `src/lib/advisor/applyAction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/applyAction.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildTask, buildLead, buildLeadPatch, applyAction } from "@/lib/advisor/applyAction";
import type { ProposedAction } from "@/lib/types";

describe("buildTask", () => {
  it("fills required defaults around the provided title", () => {
    const t = buildTask({ title: "Follow up with Acme", priority: "high" });
    expect(t).toMatchObject({
      title: "Follow up with Acme", priority: "high",
      status: "not started", category: "follow-up", linkKind: "none", linkId: null,
      dueDate: null, notes: "",
    });
  });
});

describe("buildLead", () => {
  it("defaults status/quality/source and coerces value", () => {
    const l = buildLead({ company: "Acme", estimatedValue: "5000" });
    expect(l.company).toBe("Acme");
    expect(l.status).toBe("new");
    expect(l.quality).toBe("medium");
    expect(l.source).toBe("warm lead");
    expect(l.estimatedValue).toBe(5000);
    expect(l.nextFollowUp).toBeNull();
  });
});

describe("buildLeadPatch", () => {
  it("only includes provided keys", () => {
    expect(buildLeadPatch({ status: "won" })).toEqual({ status: "won" });
    expect(buildLeadPatch({})).toEqual({});
  });
});

describe("applyAction", () => {
  it("routes create_task to store.create", () => {
    const store = { create: vi.fn(), update: vi.fn() };
    const action: ProposedAction = {
      id: "a1", tool: "create_task", description: "", status: "pending",
      args: { title: "Call back" },
    };
    applyAction(store as never, action);
    expect(store.create).toHaveBeenCalledWith("tasks", expect.objectContaining({ title: "Call back" }));
  });

  it("routes update_lead to store.update with the id", () => {
    const store = { create: vi.fn(), update: vi.fn() };
    const action: ProposedAction = {
      id: "a2", tool: "update_lead", description: "", status: "pending",
      args: { id: "l1", status: "proposal" },
    };
    applyAction(store as never, action);
    expect(store.update).toHaveBeenCalledWith("leads", "l1", { status: "proposal" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/advisor/applyAction.test.ts`
Expected: FAIL — cannot find module `@/lib/advisor/applyAction`.

- [ ] **Step 3: Implement `src/lib/advisor/applyAction.ts`**

```ts
import type {
  Lead, Task, Project, Interaction, ProposedAction,
  LeadSource, LeadStatus, LeadQuality, InteractionType,
  ProjectType, ProjectStage, Priority, TaskCategory, TaskStatus,
} from "@/lib/types";
import { todayISO } from "@/lib/utils";

type Args = Record<string, unknown>;
type New<T> = Omit<T, "id" | "createdAt" | "updatedAt">;

const str = (v: unknown) => (v == null ? "" : String(v));
const orNull = (v: unknown) => (v == null || v === "" ? null : String(v));

/** Minimal store surface applyAction needs (matches the real store's CRUD). */
export interface AdvisorStore {
  create: (key: string, value: unknown) => unknown;
  update: (key: string, id: string, patch: unknown) => void;
}

export function buildTask(a: Args): New<Task> {
  return {
    title: str(a.title),
    linkKind: (a.linkKind as Task["linkKind"]) ?? "none",
    linkId: orNull(a.linkId),
    category: (a.category as TaskCategory) ?? "follow-up",
    priority: (a.priority as Priority) ?? "medium",
    status: (a.status as TaskStatus) ?? "not started",
    dueDate: orNull(a.dueDate),
    notes: str(a.notes),
  };
}

export function buildLead(a: Args): New<Lead> {
  return {
    company: str(a.company),
    contactName: str(a.contactName),
    contactRole: str(a.contactRole),
    email: str(a.email),
    phone: str(a.phone),
    linkedinUrl: str(a.linkedinUrl),
    industry: str(a.industry),
    companyType: str(a.companyType),
    source: (a.source as LeadSource) ?? "warm lead",
    status: (a.status as LeadStatus) ?? "new",
    quality: (a.quality as LeadQuality) ?? "medium",
    painPoint: str(a.painPoint),
    objection: str(a.objection),
    buyingSignal: str(a.buyingSignal),
    lastContact: orNull(a.lastContact),
    nextFollowUp: orNull(a.nextFollowUp),
    notes: str(a.notes),
    solutionIdea: str(a.solutionIdea),
    estimatedValue: Number(a.estimatedValue) || 0,
    owner: str(a.owner),
  };
}

export function buildLeadPatch(a: Args): Partial<Lead> {
  const p: Partial<Lead> = {};
  if (a.status != null) p.status = a.status as LeadStatus;
  if (a.quality != null) p.quality = a.quality as LeadQuality;
  if (a.nextFollowUp !== undefined) p.nextFollowUp = orNull(a.nextFollowUp);
  if (a.lastContact !== undefined) p.lastContact = orNull(a.lastContact);
  if (a.notes != null) p.notes = str(a.notes);
  if (a.painPoint != null) p.painPoint = str(a.painPoint);
  if (a.objection != null) p.objection = str(a.objection);
  if (a.buyingSignal != null) p.buyingSignal = str(a.buyingSignal);
  if (a.estimatedValue != null) p.estimatedValue = Number(a.estimatedValue) || 0;
  return p;
}

export function buildProject(a: Args): New<Project> {
  return {
    name: str(a.name),
    company: str(a.company),
    type: (a.type as ProjectType) ?? "paid project",
    stage: (a.stage as ProjectStage) ?? "idea",
    priority: (a.priority as Priority) ?? "medium",
    startDate: orNull(a.startDate),
    dueDate: orNull(a.dueDate),
    currentMilestone: str(a.currentMilestone),
    currentBlocker: str(a.currentBlocker),
    nextAction: str(a.nextAction),
    deliverables: str(a.deliverables),
    notes: str(a.notes),
  };
}

export function buildInteraction(a: Args): New<Interaction> {
  return {
    leadId: orNull(a.leadId),
    company: str(a.company),
    contact: str(a.contact),
    date: a.date ? str(a.date) : todayISO(),
    type: (a.type as InteractionType) ?? "discovery call",
    rawNotes: str(a.rawNotes),
    whatTheySaid: str(a.whatTheySaid),
    painPoints: str(a.painPoints),
    objections: str(a.objections),
    buyingSignals: str(a.buyingSignals),
    followUpRequired: Boolean(a.followUpRequired),
    followUpDate: orNull(a.followUpDate),
  };
}

/** Apply a confirmed action through the store's existing CRUD. */
export function applyAction(store: AdvisorStore, action: ProposedAction): void {
  const a = action.args ?? {};
  switch (action.tool) {
    case "create_task": store.create("tasks", buildTask(a)); break;
    case "create_lead": store.create("leads", buildLead(a)); break;
    case "create_project": store.create("projects", buildProject(a)); break;
    case "log_interaction": store.create("interactions", buildInteraction(a)); break;
    case "update_lead": {
      const id = str(a.id);
      if (id) store.update("leads", id, buildLeadPatch(a));
      break;
    }
    default: break;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/advisor/applyAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/advisor/applyAction.ts src/lib/advisor/applyAction.test.ts
git commit -m "feat: advisor action builders and applier"
```

---

## Task 5: Tool schemas, skill resolvers, dispatcher (server)

**Files:**
- Create: `src/lib/advisor/tools.ts`
- Test: `src/lib/advisor/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TOOLS, describeAction, resolveTool } from "@/lib/advisor/tools";
import type { AdvisorSnapshot } from "@/lib/types";

function emptySnapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
    },
  };
}

describe("TOOLS", () => {
  it("exposes read, skill, and write tools with valid schemas", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("query_leads");
    expect(names).toContain("generate_call_summary");
    expect(names).toContain("create_task");
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("describeAction", () => {
  it("renders a human-readable line for create_task", () => {
    expect(describeAction("create_task", { title: "Call Acme", priority: "high" }))
      .toContain("Call Acme");
  });
});

describe("resolveTool", () => {
  it("resolves a read tool inline", () => {
    const proposals: unknown[] = [];
    const r = resolveTool("query_leads", {}, emptySnapshot(), proposals as never);
    expect(Array.isArray(JSON.parse(r))).toBe(true);
    expect(proposals).toHaveLength(0);
  });

  it("records a write tool as a proposal instead of executing", () => {
    const proposals: { tool: string }[] = [];
    const r = resolveTool("create_task", { title: "X" }, emptySnapshot(), proposals as never);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].tool).toBe("create_task");
    expect(JSON.parse(r)).toHaveProperty("queued", true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/advisor/tools.test.ts`
Expected: FAIL — cannot find module `@/lib/advisor/tools`.

- [ ] **Step 3: Implement `src/lib/advisor/tools.ts`**

```ts
import type { AdvisorSnapshot, ProposedAction, Scorecard, Task } from "@/lib/types";
import {
  generateCallSummary, generateBusinessReview, generateTomorrowPlan,
} from "@/lib/ai";
import { todayScorecard, openTasks, followUpsDueToday } from "@/lib/selectors";
import {
  queryLeads, queryTasks, queryProjects, queryInteractions,
  searchPainPoints, getPipelineMetrics,
} from "./readTools";

type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const obj = (properties: Record<string, unknown>, required?: string[]): ToolDef["input_schema"] =>
  ({ type: "object", properties, ...(required ? { required } : {}) });
const enumStr = (values: readonly string[], description = "") => ({ type: "string", enum: [...values], description });
const s = (description = "") => ({ type: "string", description });
const n = (description = "") => ({ type: "number", description });
const b = (description = "") => ({ type: "boolean", description });
const dateStr = (description = "") => ({ type: "string", description: `ISO date (YYYY-MM-DD). ${description}`.trim() });

/* ---------------- schemas ---------------- */

export const TOOLS: ToolDef[] = [
  // ---- read ----
  { name: "query_leads", description: "Search/filter CRM leads. Returns compact lead records (with ids).",
    input_schema: obj({
      status: s("e.g. new, contacted, interested, call booked, proposal, won, lost"),
      quality: enumStr(["low", "medium", "high"]),
      source: s(), industry: s("substring match"),
      hasFollowUp: b("only leads with a next follow-up date"),
      limit: n("default 25"),
    }) },
  { name: "query_tasks", description: "Search/filter tasks. Returns compact task records (with ids).",
    input_schema: obj({
      status: s("not started, in progress, blocked, done"),
      category: s("sales, product, delivery, admin, SEO, outreach, follow-up"),
      priority: enumStr(["low", "medium", "high"]), limit: n("default 30"),
    }) },
  { name: "query_projects", description: "Search/filter delivery projects.",
    input_schema: obj({ stage: s(), type: s(), priority: enumStr(["low", "medium", "high"]), limit: n() }) },
  { name: "query_interactions", description: "Recent call/interaction notes, newest first.",
    input_schema: obj({ leadId: s(), type: s(), company: s("substring match"), limit: n("default 20") }) },
  { name: "search_pain_points", description: "Search the pain-point bank.",
    input_schema: obj({ query: s("free-text"), industry: s(), urgency: enumStr(["low", "medium", "high"]), limit: n() }) },
  { name: "get_pipeline_metrics", description: "Dashboard metrics: pipeline counts/value, today's activity, follow-ups due.",
    input_schema: obj({}) },

  // ---- skills ----
  { name: "generate_call_summary", description: "Turn rough interaction notes into a structured call summary.",
    input_schema: obj({
      rawNotes: s(), whatTheySaid: s(), painPoints: s(), objections: s(),
      buyingSignals: s(), company: s(), contact: s(),
    }, ["rawNotes"]) },
  { name: "generate_business_review", description: "Turn a messy end-of-day brain-dump into a structured business review.",
    input_schema: obj({ text: s("the daily update text") }, ["text"]) },
  { name: "generate_tomorrow_plan", description: "Produce tomorrow's top-3 priorities from current open tasks, follow-ups and the latest scorecard.",
    input_schema: obj({}) },

  // ---- write (proposed, need confirmation) ----
  { name: "create_task", description: "Propose creating a task.",
    input_schema: obj({
      title: s(), category: s(), priority: enumStr(["low", "medium", "high"]),
      dueDate: dateStr(), notes: s(), linkKind: enumStr(["lead", "project", "none"]), linkId: s(),
    }, ["title"]) },
  { name: "create_lead", description: "Propose creating a CRM lead.",
    input_schema: obj({
      company: s(), contactName: s(), contactRole: s(), email: s(), phone: s(),
      industry: s(), source: s(), status: s(), quality: enumStr(["low", "medium", "high"]),
      painPoint: s(), estimatedValue: n(), nextFollowUp: dateStr(), notes: s(),
    }, ["company"]) },
  { name: "update_lead", description: "Propose updating an existing lead. Use an id from query_leads.",
    input_schema: obj({
      id: s("lead id"), status: s(), quality: enumStr(["low", "medium", "high"]),
      nextFollowUp: dateStr(), lastContact: dateStr(), painPoint: s(), buyingSignal: s(),
      objection: s(), estimatedValue: n(), notes: s(),
    }, ["id"]) },
  { name: "log_interaction", description: "Propose logging a call/interaction note.",
    input_schema: obj({
      company: s(), contact: s(), leadId: s(), type: s(), date: dateStr(),
      rawNotes: s(), whatTheySaid: s(), painPoints: s(), buyingSignals: s(), followUpRequired: b(),
    }, ["company"]) },
  { name: "create_project", description: "Propose creating a delivery project.",
    input_schema: obj({
      name: s(), company: s(), type: s(), stage: s(), priority: enumStr(["low", "medium", "high"]),
      dueDate: dateStr(), nextAction: s(), deliverables: s(), notes: s(),
    }, ["name"]) },
];

const WRITE_TOOLS = new Set(["create_task", "create_lead", "update_lead", "log_interaction", "create_project"]);

/* ---------------- descriptions for proposal cards ---------------- */

export function describeAction(tool: string, a: Args): string {
  const v = (k: string) => (a[k] == null ? "" : String(a[k]));
  switch (tool) {
    case "create_task": return `Create task: ${v("title") || "(untitled)"}${v("priority") ? ` · ${v("priority")} priority` : ""}${v("dueDate") ? ` · due ${v("dueDate")}` : ""}`;
    case "create_lead": return `Create lead: ${v("company") || "(no company)"}${v("contactName") ? ` — ${v("contactName")}` : ""}`;
    case "update_lead": {
      const fields = ["status", "quality", "nextFollowUp", "estimatedValue", "painPoint", "buyingSignal", "objection", "notes", "lastContact"]
        .filter((k) => a[k] != null).map((k) => `${k}=${v(k)}`).join(", ");
      return `Update lead ${v("id")}: ${fields || "(no changes)"}`;
    }
    case "log_interaction": return `Log ${v("type") || "interaction"} with ${v("company") || "—"}${v("contact") ? ` (${v("contact")})` : ""}`;
    case "create_project": return `Create project: ${v("name") || "(unnamed)"}${v("company") ? ` for ${v("company")}` : ""}`;
    default: return tool;
  }
}

/* ---------------- dispatcher ---------------- */

/**
 * Resolve a tool call to a JSON string result.
 * Read & skill tools run inline against the snapshot.
 * Write tools push a ProposedAction and return a synthetic "queued" result.
 */
export function resolveTool(
  name: string,
  args: Args,
  snapshot: AdvisorSnapshot,
  proposals: ProposedAction[],
): string {
  if (WRITE_TOOLS.has(name)) {
    const action: ProposedAction = {
      id: `act_${proposals.length + 1}_${name}`,
      tool: name,
      description: describeAction(name, args),
      args,
      status: "pending",
    };
    proposals.push(action);
    return JSON.stringify({ queued: true, note: "Proposed to the user for confirmation. Do not assume it is done.", description: action.description });
  }

  switch (name) {
    case "query_leads": return JSON.stringify(queryLeads(snapshot, args));
    case "query_tasks": return JSON.stringify(queryTasks(snapshot, args));
    case "query_projects": return JSON.stringify(queryProjects(snapshot, args));
    case "query_interactions": return JSON.stringify(queryInteractions(snapshot, args));
    case "search_pain_points": return JSON.stringify(searchPainPoints(snapshot, args));
    case "get_pipeline_metrics": return JSON.stringify(getPipelineMetrics(snapshot, args));

    case "generate_call_summary":
      return JSON.stringify(generateCallSummary({
        rawNotes: String(args.rawNotes ?? ""),
        whatTheySaid: args.whatTheySaid as string | undefined,
        painPoints: args.painPoints as string | undefined,
        objections: args.objections as string | undefined,
        buyingSignals: args.buyingSignals as string | undefined,
        company: args.company as string | undefined,
        contact: args.contact as string | undefined,
      }));
    case "generate_business_review":
      return JSON.stringify(generateBusinessReview(String(args.text ?? "")));
    case "generate_tomorrow_plan": {
      const sc: Scorecard | null = todayScorecard(snapshot.scorecards);
      const open: Task[] = openTasks(snapshot.tasks);
      const due = followUpsDueToday(snapshot.leads, snapshot.tasks);
      return JSON.stringify(generateTomorrowPlan({ scorecard: sc, openTasks: open, dueFollowUps: due }));
    }
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/advisor/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/advisor/tools.ts src/lib/advisor/tools.test.ts
git commit -m "feat: advisor tool schemas, skill resolvers, dispatcher"
```

---

## Task 6: API route — the tool-use loop

**Files:**
- Create: `src/app/api/advisor/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";
import { TOOLS, resolveTool } from "@/lib/advisor/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface AdvisorRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: AdvisorSnapshot;
  context?: { businessName?: string; founderName?: string; services?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: AdvisorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const snapshot = body.snapshot;
  if (!snapshot) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });

  const biz = body.context?.businessName || "Pallisade Data";
  const founder = body.context?.founderName || "the founder";
  const services = body.context?.services ||
    "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

  const system =
    `You are the Sales Advisor for ${biz}, a solo B2B agency run by ${founder} that sells ${services} ` +
    `to boutique asset managers and B2B service businesses. You help run the pipeline: leads, interactions, ` +
    `projects, tasks, daily scorecards and a pain-point bank.\n\n` +
    `Use the read tools (query_*, search_pain_points, get_pipeline_metrics) to ground every answer in the ` +
    `founder's real data — never invent leads, numbers or history. Use the skill tools to generate call ` +
    `summaries, business reviews and tomorrow plans when helpful.\n\n` +
    `When the founder wants to change data, call the matching write tool (create_task, create_lead, ` +
    `update_lead, log_interaction, create_project). Write tools do NOT execute immediately — they are ` +
    `queued as proposals the founder must confirm in the UI. After proposing, briefly tell them what you've ` +
    `queued and that it's awaiting their confirmation; do not claim it is already done. For update_lead, ` +
    `always pass an id you obtained from query_leads. Be concise, direct and practical.`;

  const client = new Anthropic({ apiKey });
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = (body.messages ?? []).map((m) => ({
    role: m.role, content: m.content,
  }));

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools: TOOLS as unknown as Anthropic.Tool[],
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

      // record the assistant turn, then answer every tool_use with a tool_result
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: resolveTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals),
      }));
      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      finalText = proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.";
    }

    return NextResponse.json({ content: finalText, actions: proposals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If the SDK's `Tool`/block types differ in v0.104, the `as unknown as Anthropic.Tool[]` cast and the `.filter` type-guards keep it compiling; do not remove the guards.)

- [ ] **Step 3: Smoke-test the status endpoint**

Run: `npm run dev` in one terminal, then in another:
`curl -s localhost:3000/api/advisor` (GET)
Expected: JSON `{"configured": <bool>, "model": "claude-sonnet-4-6"}`. Stop the dev server after.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/advisor/route.ts
git commit -m "feat: /api/advisor tool-use loop"
```

---

## Task 7: Client gateway

**Files:**
- Create: `src/lib/advisorClient.ts`

- [ ] **Step 1: Implement `src/lib/advisorClient.ts`**

```ts
import type { AdvisorSnapshot, DataShape, ProposedAction } from "./types";

export interface AdvisorContext {
  businessName: string;
  founderName: string;
  services: string;
}

export interface AdvisorReply {
  content: string;
  actions: ProposedAction[];
}

/** Strip the conversations collection — the advisor reads business data, not chat history. */
export function buildSnapshot(data: DataShape): AdvisorSnapshot {
  const { conversations: _conversations, ...rest } = data;
  return rest;
}

export async function getAdvisorStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/advisor", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export async function sendAdvisorTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: AdvisorSnapshot;
  context: AdvisorContext;
}): Promise<AdvisorReply> {
  const res = await fetch("/api/advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error("The Sales Advisor needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The advisor request failed.");
  }

  return (await res.json()) as AdvisorReply;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/advisorClient.ts
git commit -m "feat: advisor client gateway"
```

---

## Task 8: Presentational components

**Files:**
- Create: `src/components/advisor/MessageBubble.tsx`
- Create: `src/components/advisor/ActionCard.tsx`
- Create: `src/components/advisor/ThreadList.tsx`

- [ ] **Step 1: Implement `ActionCard.tsx`**

```tsx
"use client";

import { Check, X, Plus, PencilLine, PhoneCall, FolderPlus } from "lucide-react";
import type { ProposedAction } from "@/lib/types";

const ICON: Record<string, typeof Plus> = {
  create_task: Plus,
  create_lead: Plus,
  create_project: FolderPlus,
  log_interaction: PhoneCall,
  update_lead: PencilLine,
};

export function ActionCard({
  action, onConfirm, onDismiss,
}: {
  action: ProposedAction;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
}) {
  const Icon = ICON[action.tool] ?? Plus;
  const done = action.status === "confirmed";
  const skipped = action.status === "dismissed";

  return (
    <div
      className="flex items-center gap-3 rounded-md border bg-[var(--color-surface-2)] px-3 py-2.5 mt-2"
      style={{ borderColor: done ? "var(--color-positive)" : skipped ? "var(--color-line)" : "var(--color-line-strong)" }}
    >
      <Icon size={15} className="shrink-0" style={{ color: done ? "var(--color-positive)" : "var(--color-accent)" }} strokeWidth={1.7} />
      <span className="flex-1 text-[0.82rem] leading-snug text-[var(--color-ink-soft)]">
        {action.description}
      </span>
      {action.status === "pending" ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button className="btn btn-sm btn-accent" onClick={() => onConfirm(action)}>
            <Check size={13} /> Confirm
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onDismiss(action)}>
            <X size={13} /> Dismiss
          </button>
        </div>
      ) : (
        <span className="text-[0.72rem] shrink-0" style={{ color: done ? "var(--color-positive)" : "var(--color-dim)" }}>
          {done ? "✓ Done" : "Dismissed"}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `MessageBubble.tsx`**

```tsx
"use client";

import { Bot, User } from "lucide-react";
import type { ChatMessage, ProposedAction } from "@/lib/types";
import { ActionCard } from "./ActionCard";

export function MessageBubble({
  message, onConfirm, onDismiss,
}: {
  message: ChatMessage;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}
      >
        {isUser ? <User size={14} className="text-[var(--color-muted)]" /> : <Bot size={14} className="text-[var(--color-accent)]" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className="rounded-lg px-3.5 py-2.5 text-[0.86rem] leading-relaxed whitespace-pre-wrap"
          style={{
            background: isUser ? "var(--color-surface-2)" : "var(--color-surface)",
            border: "1px solid var(--color-line)",
            color: "var(--color-ink-soft)",
            textAlign: "left",
          }}
        >
          {message.content}
        </div>
        {message.actions?.map((a) => (
          <ActionCard key={a.id} action={a} onConfirm={onConfirm} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `ThreadList.tsx`**

```tsx
"use client";

import { Plus, MessageSquare } from "lucide-react";
import type { Conversation } from "@/lib/types";

export function ThreadList({
  conversations, activeId, onSelect, onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="flex flex-col gap-2">
      <button className="btn btn-sm w-full justify-start" onClick={onNew}>
        <Plus size={14} /> New conversation
      </button>
      <div className="flex flex-col gap-0.5 mt-1 overflow-y-auto">
        {sorted.map((c) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.8rem] truncate"
              style={{
                background: active ? "var(--color-surface-2)" : "transparent",
                color: active ? "var(--color-ink)" : "var(--color-muted)",
                border: `1px solid ${active ? "var(--color-line)" : "transparent"}`,
              }}
            >
              <MessageSquare size={13} className="shrink-0 text-[var(--color-dim)]" />
              <span className="truncate">{c.title || "Untitled"}</span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-[0.75rem] text-[var(--color-dim)] px-2.5 py-2">No conversations yet.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/advisor/
git commit -m "feat: advisor chat presentational components"
```

---

## Task 9: The `/advisor` page

**Files:**
- Create: `src/app/advisor/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, Bot } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { applyAction, type AdvisorStore } from "@/lib/advisor/applyAction";
import { buildSnapshot, getAdvisorStatus, sendAdvisorTurn } from "@/lib/advisorClient";
import type { ChatMessage, CollectionKey, Conversation, ProposedAction } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

export default function AdvisorPage() {
  const store = useStore();
  const { conversations, settings } = store;

  // The store's CRUD is generic over CollectionKey; wrap it once in the loose
  // shape applyAction expects (avoids strictFunctionTypes assignability errors).
  const crud: AdvisorStore = useMemo(() => ({
    create: (key, value) => store.create(key as CollectionKey, value as never),
    update: (key, id, patch) => store.update(key as CollectionKey, id, patch as never),
  }), [store]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getAdvisorStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<Conversation | null>(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  /** Persist a new messages array onto a conversation. */
  const setMessages = (conv: Conversation, messages: ChatMessage[]) =>
    store.update("conversations", conv.id, { messages });

  const newConversation = () => { setActiveId(null); setInput(""); setError(null); };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);

    // Ensure there is an active conversation.
    let conv = active;
    if (!conv) {
      conv = store.create("conversations", {
        title: text.slice(0, 48),
        messages: [],
      } as Omit<Conversation, "id" | "createdAt" | "updatedAt">) as Conversation;
      setActiveId(conv.id);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...conv.messages, userMsg];
    setMessages(conv, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendAdvisorTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        snapshot: buildSnapshot(store),
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          services: settings.services,
        },
      });
      const assistantMsg: ChatMessage = {
        id: uid("msg"), role: "assistant", content: reply.content,
        actions: reply.actions, createdAt: nowISO(),
      };
      setMessages(conv, [...withUser, assistantMsg]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateAction = (msgId: string, actionId: string, status: ProposedAction["status"]) => {
    if (!active) return;
    const messages = active.messages.map((m) =>
      m.id === msgId
        ? { ...m, actions: m.actions?.map((a) => (a.id === actionId ? { ...a, status } : a)) }
        : m,
    );
    setMessages(active, messages);
  };

  const confirmAction = (msg: ChatMessage) => (a: ProposedAction) => {
    applyAction(crud, a);
    updateAction(msg.id, a.id, "confirmed");
  };
  const dismissAction = (msg: ChatMessage) => (a: ProposedAction) => {
    updateAction(msg.id, a.id, "dismissed");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Advisor"
        subtitle="Ask about your pipeline, get strategy, and let the advisor draft tasks, leads and follow-ups — every change waits for your confirmation."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <Bot size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              The Sales Advisor needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app. Settings → AI shows the connection status.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5 items-start">
        <Panel title="Conversations">
          <ThreadList
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setError(null); }}
            onNew={newConversation}
          />
        </Panel>

        <Panel>
          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "60vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <Bot size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">How can I help you sell?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try “which leads are going cold?”, “draft a follow-up task for Quillmere Capital”, or “what are my top 3 priorities tomorrow?”
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={confirmAction(m)} onDismiss={dismissAction(m)} />
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
              placeholder="Ask the advisor…  (⌘/Ctrl+Enter to send)"
              disabled={loading}
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Note: `StoreValue` extends `DataShape`, so `buildSnapshot(store)` type-checks; the store's extra methods are dropped by `JSON.stringify` when the snapshot is sent.)

- [ ] **Step 3: Commit**

```bash
git add src/app/advisor/page.tsx
git commit -m "feat: sales advisor chat page"
```

---

## Task 10: Navigation entry

**Files:**
- Modify: `src/components/layout/nav.ts`

- [ ] **Step 1: Add the `Bot` import**

In the import block from `lucide-react`, add `Bot`:

```ts
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  FolderKanban,
  ListChecks,
  ClipboardList,
  Sparkles,
  Layers,
  Settings,
  Bot,
  type LucideIcon,
} from "lucide-react";
```

- [ ] **Step 2: Add the nav item**

In the `NAV` array, add the advisor entry directly above the AI Business Review (`/review`) line:

```ts
  { href: "/advisor", label: "Sales Advisor", icon: Bot, group: "Intelligence" },
  { href: "/review", label: "AI Business Review", icon: Sparkles, group: "Intelligence" },
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/nav.ts
git commit -m "feat: add Sales Advisor to navigation"
```

---

## Task 11: End-to-end verification

**Files:** none (manual).

- [ ] **Step 1: Full test suite + build**

Run: `npm test && npm run build`
Expected: all unit tests PASS; production build succeeds with no type errors.

- [ ] **Step 2: Verify with a key (real model path)**

Ensure `.env.local` has a valid `ANTHROPIC_API_KEY`. Run `npm run dev`, open `http://localhost:3000/advisor`.
- Settings → Data → "Load demo data" first so there's data to reason over.
- Ask: *"Which of my leads have a follow-up due and what should I do first?"* → expect a grounded answer referencing real demo leads (verifies read tools + snapshot).

- [ ] **Step 3: Verify a write proposal + confirm**

Ask: *"Create a high-priority follow-up task to call Quillmere Capital tomorrow."*
- Expect an assistant message plus an **action card** ("Create task: … · high priority …") with Confirm/Dismiss.
- Click **Confirm** → card flips to "✓ Done".
- Navigate to `/tasks` → the task exists. Reload the page → the conversation and the confirmed-action state persist (verifies client-side apply + blob persistence).

- [ ] **Step 4: Verify the dismiss path**

Start a new conversation, ask for another task, click **Dismiss** → card shows "Dismissed", and `/tasks` shows no new task (verifies proposals never auto-execute).

- [ ] **Step 5: Verify the unconfigured state**

Temporarily remove `ANTHROPIC_API_KEY` from `.env.local`, restart `npm run dev`, open `/advisor` → the "needs a Claude API key" panel shows; sending yields the friendly key error rather than a crash. Restore the key afterward.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify sales advisor end-to-end"
```

---

## Notes for the implementer

- **Snapshot size:** the whole `DataShape` (minus conversations) is sent per turn. For a solo-founder dataset this is small; if it ever grows large, add server-side trimming inside `resolveTool`'s read resolvers (they already cap with `limit`).
- **Writes go through the store, not the server:** never make the route mutate `data/pallisade.db`. The single source of truth for writes is the client store, which already persists through the adapter — this is what keeps every other page in sync.
- **SDK shape:** `@anthropic-ai/sdk` ^0.104 is installed. The route uses the standard `tools` + `tool_use`/`tool_result` loop. If a future bump changes block field names, the type-guards in Task 6 are the only place to adjust.
- **No mock fallback for chat** is intentional (per the spec) — open-ended conversation has no meaningful offline mock, so the page shows the configure state instead.
