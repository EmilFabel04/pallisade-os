# Pricing Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-deal quote engine in Pallisade OS that prices a project from comparable solutions and client signals rather than hours, producing floor/target/stretch numbers for a setup fee and a monthly retainer.

**Architecture:** A pure TypeScript engine (`src/lib/pricing/`) owns every number that must not be wrong — the monthly floor from real running cost, and the comparable-derived anchor range. Three narrow Claude routes supply signals: buying intent read from the CRM, client capex researched via web search, and an adjudication that places target and stretch *inside* code-computed bounds. Anything the model proposes outside those bounds is clamped, and the clamp is shown to the user rather than hidden.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19, Tailwind CSS v4, `@anthropic-ai/sdk`, libSQL (`@libsql/client`) behind the existing `StorageAdapter` seam, vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-pricing-calculator-design.md`

## Global Constraints

- **Model:** all three routes use `claude-sonnet-5`. Declare as a module-level `const MODEL = "claude-sonnet-5";` exactly as `prep/route.ts` does.
- **Structured output:** schema-validated JSON via a **forced tool call** (`tools: [saveTool]` + `tool_choice: { type: "tool", name }`, read `toolUse.input`). Do **not** use `output_config.format`. Exception: the capex route uses `tool_choice: auto` because it must let `web_search` run first.
- **Route boilerplate:** every route file starts with `export const runtime = "nodejs";` and `export const dynamic = "force-dynamic";`, and exports a `GET` returning `{ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL }`.
- **Route errors:** never return a raw error message. Use `apiError(UPSTREAM_FAILED, 502, err)` from `@/lib/api/errors`. Missing key returns `{ error: "no_key" }` with status 503.
- **All internal money is ZAR.** USD only ever appears on a `Comparable` and in the model price table; both convert at `settings.usdToZar` before entering the engine.
- **`usdToZar: 0` and `minimumSetupFee: 0` mean "unset"**, not "zero". Guard on falsiness.
- **Engine purity:** everything under `src/lib/pricing/` is pure — no `fetch`, no imports from `store.tsx`, no React. Tests run under `environment: "node"`.
- **Test file location:** colocated as `<module>.test.ts` next to the module, matching `selectors.test.ts` / `statBand.test.ts`. `vitest.config.ts` only picks up `src/**/*.test.ts`.
- **Run a single test file with:** `npx vitest run <path>`. Run everything with `npm test`.
- **Commit style:** conventional commits scoped `pricing`, e.g. `feat(pricing): ...`, matching the `feat(content):` history.
- **`output_config` typing:** the routes pass `output_config: { effort: "low" | "medium" | "high" }`. Effort is GA, but the installed `@anthropic-ai/sdk` is `^0.104.1` — if `tsc` reports `output_config` is not assignable, run `npm i @anthropic-ai/sdk@latest` rather than deleting the field or casting the whole request object. Effort is the lever that keeps the intent read cheap and the adjudication careful; silently dropping it makes both worse.

---

## File Structure

**Created — engine (pure, unit-tested):**

| File | Responsibility |
|---|---|
| `src/lib/pricing/prices.ts` | Claude model price table (USD/MTok) and lookup |
| `src/lib/pricing/opex.ts` | Monthly running cost: fixed lines + modelled AI line |
| `src/lib/pricing/attributes.ts` | Build-attribute similarity scoring |
| `src/lib/pricing/comparables.ts` | Candidate set from stored comparables + own deals, with weighting |
| `src/lib/pricing/anchor.ts` | Weight-weighted percentiles → the anchor range |
| `src/lib/pricing/bounds.ts` | Floors, ceilings, capex multiplier, price-loss cap |
| `src/lib/pricing/clamp.ts` | Forces a proposal into bounds and explains each adjustment |
| `src/lib/pricing/band.ts` | Assembles the `PriceBand`, including every degraded path |

**Created — routes and client:**

| File | Responsibility |
|---|---|
| `src/app/api/pricing/intent/route.ts` | Reads Lead + Interactions server-side, returns `IntentRead` |
| `src/app/api/pricing/capex/route.ts` | `web_search` company research, returns `CapexRead` |
| `src/app/api/pricing/adjudicate/route.ts` | Places target/stretch inside supplied bounds |
| `src/lib/pricingClient.ts` | Client-side fetch wrappers for the three routes |

**Created — UI:**

| File | Responsibility |
|---|---|
| `src/app/pricing/page.tsx` | Quote list, filters, new-quote flow, detail host |
| `src/app/pricing/comparables/page.tsx` | Comparables library |
| `src/components/pricing/QuoteDetail.tsx` | Detail shell, owns the quote's draft state |
| `src/components/pricing/BuildPanel.tsx` | The seven build attributes |
| `src/components/pricing/OpexPanel.tsx` | Opex lines + AI usage line + computed floor |
| `src/components/pricing/ReadsPanel.tsx` | Intent and capex cards with refresh |
| `src/components/pricing/PricePanel.tsx` | Floor/target/stretch grid, clamps, close-the-loop actions |

**Modified:**

| File | Change |
|---|---|
| `src/lib/types.ts` | New entities, `DataShape` keys, `AdvisorSnapshot` inclusion, `Settings` fields |
| `src/lib/db/sqlite.ts` | Two entries in `COLLECTIONS` |
| `src/lib/store.tsx` | Two keys in `EMPTY`, two typed selectors |
| `src/lib/seed.ts` | Pricing defaults in `DEFAULT_SETTINGS` |
| `src/lib/advisorClient.ts` | `buildSnapshot` destructure |
| `src/app/settings/page.tsx` | Pricing settings block |
| `src/components/layout/*` | Nav entry for `/pricing` |

---

## Task 1: Data model and collection registration

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db/sqlite.ts:16-39` (`COLLECTIONS`)
- Modify: `src/lib/store.tsx` (`EMPTY`, typed selectors)
- Modify: `src/lib/seed.ts:22-31` (`DEFAULT_SETTINGS`)
- Modify: `src/lib/advisorClient.ts:20-23` (`buildSnapshot`)
- Test: `src/lib/pricing/registration.test.ts`

**Interfaces:**
- Consumes: nothing — this is the foundation task.
- Produces: `BuildAttributes`, `BuildStatus`, `AiDepth`, `SupportLoad`, `Comparable`, `ComparableKind`, `Quote`, `QuoteStatus`, `LostReason`, `OpexLine`, `AiUsageLine`, `IntentRead`, `CapexRead`, `PriceTriple`, `MatchedComparable`, `PriceBand`, plus `Settings.targetMarginPct`, `Settings.minimumSetupFee`, `Settings.usdToZar`, `Settings.capexMultipliers`. Every later task depends on these names.

Two collections behave differently at the disclosure boundary and the test below pins both. `collectCandidates` reads an explicit `SPECS` allowlist, so new collections are excluded from the content engine **by construction** — the test guards against someone later adding them. `buildSnapshot` is also an allowlist, so the Sales Advisor needs an explicit edit to see quotes.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/registration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "@/lib/db/sqlite";
import { buildSnapshot } from "@/lib/advisorClient";
import { collectCandidates } from "@/lib/content/daily/harvest";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { DataShape, Quote } from "@/lib/types";

const EMPTY_SHAPE = {
  leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
  painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
  positioningProfiles: [], voiceSamples: [], voiceProfile: [], contentThreads: [],
  brainThreads: [], newsFeed: [], newsInterests: [], newsBookmarks: [], notes: [],
  metricEntries: [], milestones: [], projectThreads: [],
  quotes: [], comparables: [],
  settings: DEFAULT_SETTINGS,
} as DataShape;

const QUOTE: Quote = {
  id: "q1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  leadId: "l1", name: "Investor reporting build",
  attributes: {
    buildStatus: "new", surfaces: 4, integrations: ["Xero"], dataSources: 2,
    aiDepth: "core", userCount: 12, supportLoad: "medium",
  },
  opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
  status: "won", sentSetup: 120000, sentMonthly: 9000,
  closedSetup: 120000, closedMonthly: 9000, lostReason: "", notes: "",
};

describe("pricing collection registration", () => {
  it("registers both collections for persistence", () => {
    expect(COLLECTIONS).toContain("quotes");
    expect(COLLECTIONS).toContain("comparables");
  });

  it("exposes quotes to the Sales Advisor", () => {
    const snap = buildSnapshot({ ...EMPTY_SHAPE, quotes: [QUOTE] });
    expect(snap.quotes).toHaveLength(1);
    expect(snap.comparables).toEqual([]);
  });

  it("never feeds quote money to the content engine", () => {
    const items = collectCandidates({ ...EMPTY_SHAPE, quotes: [QUOTE] });
    const blob = JSON.stringify(items);
    expect(blob).not.toContain("120000");
    expect(blob).not.toContain("Investor reporting build");
  });

  it("ships pricing defaults, with the unset sentinels at zero", () => {
    expect(DEFAULT_SETTINGS.targetMarginPct).toBe(0.4);
    expect(DEFAULT_SETTINGS.capexMultipliers).toEqual({
      micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0,
    });
    expect(DEFAULT_SETTINGS.minimumSetupFee).toBe(0);
    expect(DEFAULT_SETTINGS.usdToZar).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/registration.test.ts`
Expected: FAIL — TypeScript cannot resolve `quotes`/`comparables` on `DataShape`, and `DEFAULT_SETTINGS.targetMarginPct` does not exist.

- [ ] **Step 3: Add the entity types**

Append to `src/lib/types.ts`, after the `MetricEntry` interface and **before** the `/* ---------- collections registry ---------- */` comment:

```ts
/* ---------- pricing ---------- */

export const BUILD_STATUSES = ["new", "adapt existing", "license as-is"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const AI_DEPTHS = ["none", "light", "core"] as const;
export type AiDepth = (typeof AI_DEPTHS)[number];

export const SUPPORT_LOADS = ["low", "medium", "high"] as const;
export type SupportLoad = (typeof SUPPORT_LOADS)[number];

/** How a build is described. A quote and a comparable use the same vocabulary —
    that is the only reason matching them means anything. */
export interface BuildAttributes {
  buildStatus: BuildStatus;
  surfaces: number;
  integrations: string[];
  dataSources: number;
  aiDepth: AiDepth;
  userCount: number;
  supportLoad: SupportLoad;
}

export const COMPARABLE_KINDS = ["market", "reference"] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];

/** Market examples and reference builds. Own deals are NOT stored here — they
    are derived from `quotes`, so there is nothing to keep in sync. */
export interface Comparable extends BaseRecord {
  kind: ComparableKind;
  name: string;
  notes: string;
  sourceUrl: string;
  attributes: BuildAttributes;
  setupPrice: number;
  monthlyPrice: number;
  currency: "ZAR" | "USD";
}

export const QUOTE_STATUSES = ["draft", "sent", "won", "lost"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const LOST_REASONS = ["price", "timing", "fit", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export interface OpexLine {
  id: string;
  label: string;
  monthlyCost: number; // ZAR
}

export interface AiUsageLine {
  model: string;
  runsPerDay: number;
  inputTokensPerRun: number;
  outputTokensPerRun: number;
  inputPriceOverride: number | null; // USD per 1M tokens
  outputPriceOverride: number | null; // USD per 1M tokens
}

export interface IntentRead {
  score: number; // 0-100
  band: "cold" | "warm" | "hot";
  signals: { quote: string; weight: number }[];
  risks: string[];
  generatedAt: string;
}

export type CapexBand = "unknown" | "micro" | "small" | "mid" | "enterprise";

export interface CapexRead {
  band: CapexBand;
  headcount: number | null;
  revenueNote: string;
  evidence: { claim: string; url: string }[];
  confidence: "low" | "medium" | "high";
  generatedAt: string;
}

export interface PriceTriple {
  floor: number;
  target: number;
  stretch: number;
}

export interface MatchedComparable {
  source: "comparable" | "quote";
  id: string;
  label: string;
  similarity: number;
  weight: number;
}

export interface PriceBand {
  /** null when there are too few comparables to anchor a setup fee. */
  setup: PriceTriple | null;
  /** Always computable — opex is always known. */
  monthly: PriceTriple;
  anchor: { low: number; mid: number; high: number } | null;
  /** Anchor contributors only. Price-losses report through `clamps`. */
  matched: MatchedComparable[];
  clamps: string[];
  degraded: string[];
  reasoning: string;
  computedAt: string;
}

export interface Quote extends BaseRecord {
  leadId: string;
  name: string;
  attributes: BuildAttributes;
  opexLines: OpexLine[];
  aiUsage: AiUsageLine | null;
  intent: IntentRead | null;
  capex: CapexRead | null;
  band: PriceBand | null;
  status: QuoteStatus;
  sentSetup: number;
  sentMonthly: number;
  closedSetup: number;
  closedMonthly: number;
  /** Only "price" losses inform the ceiling — a deal lost on timing must not
      drag your pricing down. */
  lostReason: LostReason | "";
  notes: string;
}
```

- [ ] **Step 4: Register the collections and extend Settings**

In `src/lib/types.ts`, add two keys to `DataShape` (immediately after `projectThreads`):

```ts
  projectThreads: ProjectThread[];
  quotes: Quote[];
  comparables: Comparable[];
  settings: Settings;
```

`AdvisorSnapshot` is an `Omit` list — `quotes` and `comparables` are **not** added to it, so they flow through. Add a note so the omission reads as deliberate:

```ts
export type AdvisorSnapshot = Omit<
  DataShape,
  | "conversations" | "playbooks" | "targets" | "positioningProfiles"
  | "contentThreads" | "brainThreads" | "projectThreads"
  | "newsFeed" | "newsInterests" | "newsBookmarks"
  | "notes" | "metricEntries"
  // The founder's raw writing samples are content-studio material, not sales
  // context — omitted for the same reason positioningProfiles is.
  | "voiceSamples" | "voiceProfile"
  // quotes and comparables are deliberately NOT omitted: what was quoted to a
  // company is exactly what the Sales Advisor needs.
>;
```

Extend `Settings` in the same file:

```ts
export interface Settings {
  businessName: string;
  founderName: string;
  mainMarket: string;
  services: string;
  accentColor: string;
  currency: "ZAR" | "USD";
  secondaryCurrencyEnabled: boolean;
  /* pricing — 0 means "unset" for the two below, not "zero" */
  targetMarginPct: number;
  minimumSetupFee: number;
  usdToZar: number;
  capexMultipliers: { micro: number; small: number; mid: number; enterprise: number };
}
```

- [ ] **Step 5: Wire persistence, store and snapshot**

In `src/lib/db/sqlite.ts`, add to the end of the `COLLECTIONS` array (after `"projectThreads"`):

```ts
  "projectThreads",
  "quotes",
  "comparables",
] as const;
```

In `src/lib/store.tsx`, add to `EMPTY` (after `projectThreads: []`):

```ts
  projectThreads: [],
  quotes: [],
  comparables: [],
  settings: DEFAULT_SETTINGS,
```

Add the type imports `Comparable, Quote` to the existing `import type { ... } from "./types";` block, and append two selectors at the end of the file:

```ts
export const useQuotes = () => useStore().quotes as Quote[];
export const useComparables = () => useStore().comparables as Comparable[];
```

In `src/lib/advisorClient.ts`, extend the `buildSnapshot` destructure — it is an allowlist, so omitting this leaves the Advisor blind to quotes:

```ts
export function buildSnapshot(data: DataShape): AdvisorSnapshot {
  const { leads, interactions, projects, tasks, scorecards, painPoints, dialLists, milestones, quotes, comparables, settings } = data;
  return { leads, interactions, projects, tasks, scorecards, painPoints, dialLists, milestones, quotes, comparables, settings };
}
```

In `src/lib/seed.ts`, extend `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: Settings = {
  businessName: "Pallisade Data",
  founderName: "Emil",
  mainMarket: "Boutique asset managers and B2B service businesses",
  services:
    "Bespoke AI systems, workflow automation, custom software, dashboards, reporting tools",
  accentColor: "#e5484d",
  currency: "ZAR",
  secondaryCurrencyEnabled: true,
  targetMarginPct: 0.4,
  minimumSetupFee: 0,
  usdToZar: 0,
  capexMultipliers: { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 },
};
```

`seedData()` returns a `DataShape`; add `quotes: [], comparables: [],` to the object it builds so the demo dataset still type-checks.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/registration.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Verify nothing else broke**

Run: `npm test && npx tsc --noEmit`
Expected: the full suite passes and there are no type errors. `DataShape` gained two required keys, so any object literal building a full shape must now include them — fix the ones the compiler names.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/db/sqlite.ts src/lib/store.tsx src/lib/seed.ts src/lib/advisorClient.ts src/lib/pricing/registration.test.ts
git commit -m "feat(pricing): register quotes and comparables collections"
```

---

## Task 2: Model price table and monthly opex

**Files:**
- Create: `src/lib/pricing/prices.ts`
- Create: `src/lib/pricing/opex.ts`
- Test: `src/lib/pricing/opex.test.ts`

**Interfaces:**
- Consumes: `OpexLine`, `AiUsageLine` from Task 1.
- Produces: `MODEL_PRICES`, `PRICED_MODELS`, `priceFor(model: string): ModelPrice | null`, `DAYS_PER_MONTH`, `monthlyOpex(lines: OpexLine[], ai: AiUsageLine | null, usdToZar: number): OpexResult` where `OpexResult = { fixed: number; ai: number; total: number; breakdown: { label: string; monthlyCost: number }[]; unpricedModel: string | null }`. Tasks 8, 13 and 15 use these.

The table carries **standard** rates, never promotional ones. Sonnet 5 runs an introductory $2/$10 per MTok until 2026-08-31; quoting a multi-year retainer against a discount that expires in weeks is precisely the error this table exists to prevent.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/opex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthlyOpex, DAYS_PER_MONTH } from "./opex";
import { priceFor, PRICED_MODELS } from "./prices";
import type { AiUsageLine, OpexLine } from "@/lib/types";

const LINES: OpexLine[] = [
  { id: "a", label: "Hosting", monthlyCost: 400 },
  { id: "b", label: "Database", monthlyCost: 250 },
];

const AI: AiUsageLine = {
  model: "claude-sonnet-5",
  runsPerDay: 100,
  inputTokensPerRun: 2000,
  outputTokensPerRun: 500,
  inputPriceOverride: null,
  outputPriceOverride: null,
};

describe("prices", () => {
  it("prices the current models at standard, not promotional, rates", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({ input: 3, output: 15 });
    expect(priceFor("claude-opus-5")).toEqual({ input: 5, output: 25 });
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
  });

  it("returns null for a model it does not know", () => {
    expect(priceFor("gpt-hypothetical")).toBeNull();
  });

  it("exposes the model list for the usage form", () => {
    expect(PRICED_MODELS).toContain("claude-sonnet-5");
  });
});

describe("monthlyOpex", () => {
  it("sums fixed lines when there is no AI usage", () => {
    const r = monthlyOpex(LINES, null, 18);
    expect(r.fixed).toBe(650);
    expect(r.ai).toBe(0);
    expect(r.total).toBe(650);
    expect(r.breakdown).toHaveLength(2);
    expect(r.unpricedModel).toBeNull();
  });

  it("models the AI line from tokens, runs and the FX rate", () => {
    // per run: 2000/1e6*3 + 500/1e6*15 = 0.006 + 0.0075 = 0.0135 USD
    const perRunUsd = 0.0135;
    const expectedZar = 100 * DAYS_PER_MONTH * perRunUsd * 18;
    const r = monthlyOpex(LINES, AI, 18);
    expect(r.ai).toBeCloseTo(expectedZar, 6);
    expect(r.total).toBeCloseTo(650 + expectedZar, 6);
    expect(r.breakdown.at(-1)!.label).toContain("claude-sonnet-5");
  });

  it("prefers an explicit price override over the table", () => {
    const overridden: AiUsageLine = { ...AI, inputPriceOverride: 30, outputPriceOverride: 150 };
    const plain = monthlyOpex([], AI, 18);
    const custom = monthlyOpex([], overridden, 18);
    expect(custom.ai).toBeCloseTo(plain.ai * 10, 4);
  });

  it("reports an unpriced model instead of silently costing it at zero", () => {
    const r = monthlyOpex([], { ...AI, model: "gpt-hypothetical" }, 18);
    expect(r.unpricedModel).toBe("gpt-hypothetical");
    expect(r.ai).toBe(0);
  });

  it("treats usdToZar of 0 as unset and reports the AI line as unpriced", () => {
    const r = monthlyOpex(LINES, AI, 0);
    expect(r.ai).toBe(0);
    expect(r.total).toBe(650);
    expect(r.unpricedModel).toBe("claude-sonnet-5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/opex.test.ts`
Expected: FAIL — `Cannot find module './opex'`.

- [ ] **Step 3: Write the price table**

Create `src/lib/pricing/prices.ts`:

```ts
/* ============================================================
   Claude model prices, USD per 1,000,000 tokens.

   STANDARD rates only — never promotional ones. Sonnet 5 carries an
   introductory $2/$10 through 2026-08-31; a retainer priced against a
   discount that expires is exactly the error this table prevents.

   An AiUsageLine may override either price, so a stale table can
   always be corrected per-quote without a deploy.
   ============================================================ */

export interface ModelPrice {
  input: number;
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const PRICED_MODELS: string[] = Object.keys(MODEL_PRICES);

export function priceFor(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}
```

- [ ] **Step 4: Write the opex calculator**

Create `src/lib/pricing/opex.ts`:

```ts
import type { AiUsageLine, OpexLine } from "@/lib/types";
import { priceFor } from "./prices";

/** Mean days per month — the AI line scales with usage, not with calendar length. */
export const DAYS_PER_MONTH = 30.44;

export interface OpexResult {
  fixed: number;
  ai: number;
  total: number;
  breakdown: { label: string; monthlyCost: number }[];
  /** Set when the AI line could not be costed, so the caller can degrade loudly
      rather than quote a retainer against a silent zero. */
  unpricedModel: string | null;
}

export function monthlyOpex(
  lines: OpexLine[],
  ai: AiUsageLine | null,
  usdToZar: number,
): OpexResult {
  const fixed = lines.reduce((sum, l) => sum + (l.monthlyCost || 0), 0);
  const breakdown = lines.map((l) => ({
    label: l.label,
    monthlyCost: l.monthlyCost || 0,
  }));

  if (!ai) return { fixed, ai: 0, total: fixed, breakdown, unpricedModel: null };

  const table = priceFor(ai.model);
  const inPrice = ai.inputPriceOverride ?? table?.input ?? null;
  const outPrice = ai.outputPriceOverride ?? table?.output ?? null;

  // No resolvable price, or no FX rate to convert one. Either way the line is
  // uncosted; report it rather than folding a zero into the floor.
  if (inPrice === null || outPrice === null || !usdToZar) {
    return { fixed, ai: 0, total: fixed, breakdown, unpricedModel: ai.model };
  }

  const perRunUsd =
    (ai.inputTokensPerRun / 1e6) * inPrice + (ai.outputTokensPerRun / 1e6) * outPrice;
  const aiZar = ai.runsPerDay * DAYS_PER_MONTH * perRunUsd * usdToZar;

  breakdown.push({ label: `AI — ${ai.model}`, monthlyCost: aiZar });
  return { fixed, ai: aiZar, total: fixed + aiZar, breakdown, unpricedModel: null };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/opex.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/prices.ts src/lib/pricing/opex.ts src/lib/pricing/opex.test.ts
git commit -m "feat(pricing): monthly opex with a usage-driven AI line"
```

---

## Task 3: Build-attribute similarity

**Files:**
- Create: `src/lib/pricing/attributes.ts`
- Test: `src/lib/pricing/attributes.test.ts`

**Interfaces:**
- Consumes: `BuildAttributes`, `AI_DEPTHS`, `SUPPORT_LOADS` from Task 1.
- Produces: `similarity(a: BuildAttributes, b: BuildAttributes): number` (0–1), plus `numericCloseness(a: number, b: number): number` and `jaccard(a: string[], b: string[]): number` for direct testing. Task 4 consumes `similarity`.

`buildStatus` is deliberately **excluded** from similarity. It is a floor modifier, not a match dimension — an already-built product is worth the same to a client as a new one, so it must never shift the anchor.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/attributes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { similarity, numericCloseness, jaccard } from "./attributes";
import type { BuildAttributes } from "@/lib/types";

const BASE: BuildAttributes = {
  buildStatus: "new",
  surfaces: 6,
  integrations: ["Gmail", "Xero"],
  dataSources: 3,
  aiDepth: "core",
  userCount: 20,
  supportLoad: "medium",
};

describe("numericCloseness", () => {
  it("is 1 for equal values", () => expect(numericCloseness(5, 5)).toBe(1));
  it("falls toward 0 as the gap approaches the larger value", () => {
    expect(numericCloseness(1, 10)).toBeCloseTo(0.1, 6);
  });
  it("treats 0 and 0 as identical rather than dividing by zero", () => {
    expect(numericCloseness(0, 0)).toBe(1);
  });
});

describe("jaccard", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(jaccard(["Gmail", " xero "], ["gmail", "XERO"])).toBe(1);
  });
  it("scores partial overlap", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 6);
  });
  it("treats two empty sets as identical", () => {
    expect(jaccard([], [])).toBe(1);
  });
  it("scores disjoint sets at 0", () => {
    expect(jaccard(["a"], ["b"])).toBe(0);
  });
});

describe("similarity", () => {
  it("scores identical attributes at 1", () => {
    expect(similarity(BASE, BASE)).toBeCloseTo(1, 6);
  });

  it("ignores buildStatus entirely", () => {
    const licensed: BuildAttributes = { ...BASE, buildStatus: "license as-is" };
    expect(similarity(BASE, licensed)).toBeCloseTo(1, 6);
  });

  it("scores a maximally different build near 0", () => {
    const other: BuildAttributes = {
      buildStatus: "new",
      surfaces: 400,
      integrations: ["Salesforce"],
      dataSources: 300,
      aiDepth: "none",
      userCount: 100000,
      supportLoad: "low",
    };
    expect(similarity(BASE, other)).toBeLessThan(0.2);
  });

  it("is symmetric", () => {
    const other: BuildAttributes = { ...BASE, surfaces: 2, aiDepth: "light" };
    expect(similarity(BASE, other)).toBeCloseTo(similarity(other, BASE), 9);
  });

  it("scales user count logarithmically, so 20 vs 200 beats 20 vs 200000", () => {
    const near: BuildAttributes = { ...BASE, userCount: 200 };
    const far: BuildAttributes = { ...BASE, userCount: 200000 };
    expect(similarity(BASE, near)).toBeGreaterThan(similarity(BASE, far));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/attributes.test.ts`
Expected: FAIL — `Cannot find module './attributes'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/attributes.ts`:

```ts
import type { BuildAttributes } from "@/lib/types";
import { AI_DEPTHS, SUPPORT_LOADS } from "@/lib/types";

/* Weights sum to 1. buildStatus is absent on purpose: it is a floor modifier,
   not a match dimension. An already-built product is worth the same to the
   client as a new one, so it must never move the anchor. */
const WEIGHTS = {
  surfaces: 0.2,
  integrations: 0.2,
  dataSources: 0.15,
  aiDepth: 0.2,
  userCount: 0.15,
  supportLoad: 0.1,
} as const;

/** 1 when equal, falling to 0 as the gap approaches the larger of the two. */
export function numericCloseness(a: number, b: number): number {
  const denom = Math.max(a, b, 1);
  return 1 - Math.min(1, Math.abs(a - b) / denom);
}

/** Set overlap, case- and whitespace-insensitive. Two empty sets are identical. */
export function jaccard(a: string[], b: string[]): number {
  const norm = (xs: string[]) =>
    new Set(xs.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Distance between two positions on an ordered scale, normalised to 0–1. */
function ordinalCloseness(a: string, b: string, scale: readonly string[]): number {
  const ia = scale.indexOf(a);
  const ib = scale.indexOf(b);
  if (ia < 0 || ib < 0 || scale.length < 2) return 0;
  return 1 - Math.abs(ia - ib) / (scale.length - 1);
}

export function similarity(a: BuildAttributes, b: BuildAttributes): number {
  return (
    WEIGHTS.surfaces * numericCloseness(a.surfaces, b.surfaces) +
    WEIGHTS.integrations * jaccard(a.integrations, b.integrations) +
    WEIGHTS.dataSources * numericCloseness(a.dataSources, b.dataSources) +
    WEIGHTS.aiDepth * ordinalCloseness(a.aiDepth, b.aiDepth, AI_DEPTHS) +
    // Log-scaled: 20 users vs 200 is a far smaller difference than 20 vs 200,000.
    WEIGHTS.userCount *
      numericCloseness(Math.log10(1 + a.userCount), Math.log10(1 + b.userCount)) +
    WEIGHTS.supportLoad * ordinalCloseness(a.supportLoad, b.supportLoad, SUPPORT_LOADS)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/attributes.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/attributes.ts src/lib/pricing/attributes.test.ts
git commit -m "feat(pricing): attribute similarity scoring for build matching"
```

---

## Task 4: Candidate set from comparables and own deals

**Files:**
- Create: `src/lib/pricing/comparables.ts`
- Test: `src/lib/pricing/comparables.test.ts`

**Interfaces:**
- Consumes: `similarity` from Task 3; `BuildAttributes`, `Comparable`, `Quote` from Task 1.
- Produces: `OUTCOME_WEIGHTS`, `MIN_SIMILARITY`, the `Candidate` interface, and `buildCandidates(params): CandidateSet`. Tasks 5, 6 and 8 consume these.

```ts
export interface Candidate {
  source: "comparable" | "quote";
  id: string;
  label: string;
  attributes: BuildAttributes;
  setupPrice: number;   // ZAR
  monthlyPrice: number; // ZAR
  outcomeWeight: number;
  similarity: number;
  weight: number;       // similarity × outcomeWeight
}

export interface CandidateSet {
  candidates: Candidate[];  // anchor contributors
  priceLosses: Candidate[]; // lost-on-price quotes; ceiling evidence only
  droppedForFx: number;     // USD comparables skipped because usdToZar is unset
}
```

Own **won** deals carry the heaviest weight because they are the only proof of what actually clears. Own **lost** deals never enter the anchor — a price you failed to get is not evidence of what a build is worth — but a loss *specifically on price* caps the stretch, which Task 6 applies.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/comparables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCandidates, OUTCOME_WEIGHTS, MIN_SIMILARITY } from "./comparables";
import type { BuildAttributes, Comparable, Quote } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new",
  surfaces: 6,
  integrations: ["Gmail", "Xero"],
  dataSources: 3,
  aiDepth: "core",
  userCount: 20,
  supportLoad: "medium",
};

const FAR: BuildAttributes = {
  buildStatus: "new",
  surfaces: 400,
  integrations: ["Salesforce"],
  dataSources: 300,
  aiDepth: "none",
  userCount: 100000,
  supportLoad: "low",
};

function comparable(over: Partial<Comparable>): Comparable {
  return {
    id: "c1", createdAt: "", updatedAt: "",
    kind: "market", name: "Vendor X", notes: "", sourceUrl: "",
    attributes: ATTRS, setupPrice: 100000, monthlyPrice: 8000, currency: "ZAR",
    ...over,
  };
}

function quote(over: Partial<Quote>): Quote {
  return {
    id: "q1", createdAt: "", updatedAt: "",
    leadId: "l1", name: "Acme build", attributes: ATTRS,
    opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
    status: "won", sentSetup: 130000, sentMonthly: 9000,
    closedSetup: 125000, closedMonthly: 8500, lostReason: "", notes: "",
    ...over,
  };
}

const BASE = { attributes: ATTRS, currentQuoteId: "current", usdToZar: 18 };

describe("buildCandidates", () => {
  it("weights own won deals above market examples above reference builds", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [
        comparable({ id: "m1", kind: "market" }),
        comparable({ id: "r1", kind: "reference" }),
      ],
      quotes: [quote({ id: "w1", status: "won" })],
    });
    const byId = Object.fromEntries(set.candidates.map((c) => [c.id, c]));
    expect(byId.w1.outcomeWeight).toBe(OUTCOME_WEIGHTS.won);
    expect(byId.m1.outcomeWeight).toBe(OUTCOME_WEIGHTS.market);
    expect(byId.r1.outcomeWeight).toBe(OUTCOME_WEIGHTS.reference);
    expect(byId.w1.weight).toBeGreaterThan(byId.m1.weight);
    expect(byId.m1.weight).toBeGreaterThan(byId.r1.weight);
  });

  it("uses closed prices for wins and asked prices for price-losses", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [
        quote({ id: "w1", status: "won" }),
        quote({ id: "l1", status: "lost", lostReason: "price" }),
      ],
    });
    expect(set.candidates.map((c) => c.id)).toEqual(["w1"]);
    expect(set.candidates[0].setupPrice).toBe(125000);
    expect(set.priceLosses.map((c) => c.id)).toEqual(["l1"]);
    expect(set.priceLosses[0].setupPrice).toBe(130000);
  });

  it("ignores losses that were not about price", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [quote({ id: "l2", status: "lost", lostReason: "timing" })],
    });
    expect(set.candidates).toHaveLength(0);
    expect(set.priceLosses).toHaveLength(0);
  });

  it("ignores draft and sent quotes, and the quote being priced", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [
        quote({ id: "d1", status: "draft" }),
        quote({ id: "s1", status: "sent" }),
        quote({ id: "current", status: "won" }),
      ],
    });
    expect(set.candidates).toHaveLength(0);
  });

  it("converts USD comparables at the FX rate", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "u1", currency: "USD", setupPrice: 5000, monthlyPrice: 400 })],
      quotes: [],
    });
    expect(set.candidates[0].setupPrice).toBe(90000);
    expect(set.candidates[0].monthlyPrice).toBe(7200);
  });

  it("drops USD comparables when the FX rate is unset, and counts them", () => {
    const set = buildCandidates({
      ...BASE,
      usdToZar: 0,
      comparables: [
        comparable({ id: "u1", currency: "USD" }),
        comparable({ id: "z1", currency: "ZAR" }),
      ],
      quotes: [],
    });
    expect(set.candidates.map((c) => c.id)).toEqual(["z1"]);
    expect(set.droppedForFx).toBe(1);
  });

  it("excludes anything below the similarity floor", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "far", attributes: FAR })],
      quotes: [],
    });
    expect(set.candidates).toHaveLength(0);
    expect(MIN_SIMILARITY).toBe(0.5);
  });

  it("skips records with no usable setup price", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "zero", setupPrice: 0 })],
      quotes: [quote({ id: "w0", status: "won", closedSetup: 0 })],
    });
    expect(set.candidates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/comparables.test.ts`
Expected: FAIL — `Cannot find module './comparables'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/comparables.ts`:

```ts
import type { BuildAttributes, Comparable, Quote } from "@/lib/types";
import { similarity } from "./attributes";

/* Own won deals are the only proof of what actually clears, so they outweigh
   what the market publishes, which in turn outweighs an anchor you authored
   yourself. */
export const OUTCOME_WEIGHTS = {
  won: 1.0,
  market: 0.7,
  reference: 0.6,
} as const;

/** Below this, a comparable is not comparable. */
export const MIN_SIMILARITY = 0.5;

export interface Candidate {
  source: "comparable" | "quote";
  id: string;
  label: string;
  attributes: BuildAttributes;
  setupPrice: number;
  monthlyPrice: number;
  outcomeWeight: number;
  similarity: number;
  weight: number;
}

export interface CandidateSet {
  candidates: Candidate[];
  priceLosses: Candidate[];
  droppedForFx: number;
}

export interface CandidateParams {
  attributes: BuildAttributes;
  comparables: Comparable[];
  quotes: Quote[];
  /** Excluded from its own candidate set. */
  currentQuoteId: string;
  usdToZar: number;
}

export function buildCandidates(params: CandidateParams): CandidateSet {
  const { attributes, comparables, quotes, currentQuoteId, usdToZar } = params;
  const candidates: Candidate[] = [];
  const priceLosses: Candidate[] = [];
  let droppedForFx = 0;

  const make = (
    source: Candidate["source"],
    id: string,
    label: string,
    attrs: BuildAttributes,
    setupPrice: number,
    monthlyPrice: number,
    outcomeWeight: number,
  ): Candidate => {
    const sim = similarity(attributes, attrs);
    return {
      source, id, label, attributes: attrs,
      setupPrice, monthlyPrice, outcomeWeight,
      similarity: sim,
      weight: sim * outcomeWeight,
    };
  };

  for (const c of comparables) {
    if (c.currency === "USD" && !usdToZar) {
      droppedForFx++;
      continue;
    }
    const rate = c.currency === "USD" ? usdToZar : 1;
    const setupPrice = c.setupPrice * rate;
    if (setupPrice <= 0) continue;
    const cand = make(
      "comparable", c.id, c.name, c.attributes,
      setupPrice, c.monthlyPrice * rate,
      c.kind === "market" ? OUTCOME_WEIGHTS.market : OUTCOME_WEIGHTS.reference,
    );
    if (cand.similarity >= MIN_SIMILARITY) candidates.push(cand);
  }

  for (const q of quotes) {
    if (q.id === currentQuoteId) continue;

    if (q.status === "won") {
      if (q.closedSetup <= 0) continue;
      const cand = make(
        "quote", q.id, q.name, q.attributes,
        q.closedSetup, q.closedMonthly, OUTCOME_WEIGHTS.won,
      );
      if (cand.similarity >= MIN_SIMILARITY) candidates.push(cand);
      continue;
    }

    // A deal lost on price is evidence about the ceiling, not about worth — it
    // never enters the anchor. A deal lost on timing or fit says nothing at all.
    if (q.status === "lost" && q.lostReason === "price") {
      if (q.sentSetup <= 0) continue;
      const cand = make(
        "quote", q.id, q.name, q.attributes,
        q.sentSetup, q.sentMonthly, OUTCOME_WEIGHTS.won,
      );
      if (cand.similarity >= MIN_SIMILARITY) priceLosses.push(cand);
    }
  }

  return { candidates, priceLosses, droppedForFx };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/comparables.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/comparables.ts src/lib/pricing/comparables.test.ts
git commit -m "feat(pricing): candidate set from comparables and closed deals"
```

---

## Task 5: The anchor range

**Files:**
- Create: `src/lib/pricing/anchor.ts`
- Test: `src/lib/pricing/anchor.test.ts`

**Interfaces:**
- Consumes: `Candidate` from Task 4.
- Produces: `MIN_CANDIDATES`, `Anchor` (`{ low: number; mid: number; high: number }`), `weightedPercentile(points: { value: number; weight: number }[], fraction: number): number`, `anchorFrom(candidates: Candidate[], pick: (c: Candidate) => number): Anchor | null`. Tasks 6 and 8 consume these.

Under three candidates there is no anchor and the tool says so rather than inventing a number from one data point.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/anchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anchorFrom, weightedPercentile, MIN_CANDIDATES } from "./anchor";
import type { Candidate } from "./comparables";
import type { BuildAttributes } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: [], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

function cand(id: string, setupPrice: number, weight: number): Candidate {
  return {
    source: "comparable", id, label: id, attributes: ATTRS,
    setupPrice, monthlyPrice: setupPrice / 12,
    outcomeWeight: 1, similarity: weight, weight,
  };
}

describe("weightedPercentile", () => {
  it("returns the value where the running weight first crosses the fraction", () => {
    const points = [
      { value: 10, weight: 1 },
      { value: 20, weight: 1 },
      { value: 30, weight: 1 },
      { value: 40, weight: 1 },
    ];
    expect(weightedPercentile(points, 0.25)).toBe(10);
    expect(weightedPercentile(points, 0.5)).toBe(20);
    expect(weightedPercentile(points, 0.75)).toBe(30);
  });

  it("lets a heavy point dominate a light one", () => {
    const points = [
      { value: 10, weight: 0.1 },
      { value: 100, weight: 9.9 },
    ];
    expect(weightedPercentile(points, 0.5)).toBe(100);
  });

  it("sorts by value, not by input order", () => {
    const points = [
      { value: 30, weight: 1 },
      { value: 10, weight: 1 },
      { value: 20, weight: 1 },
    ];
    expect(weightedPercentile(points, 0.5)).toBe(20);
  });
});

describe("anchorFrom", () => {
  it("requires at least three candidates", () => {
    expect(MIN_CANDIDATES).toBe(3);
    expect(anchorFrom([cand("a", 100, 1), cand("b", 200, 1)], (c) => c.setupPrice)).toBeNull();
  });

  it("produces a non-decreasing low/mid/high", () => {
    const a = anchorFrom(
      [cand("a", 80000, 1), cand("b", 100000, 1), cand("c", 140000, 1), cand("d", 200000, 1)],
      (c) => c.setupPrice,
    );
    expect(a).not.toBeNull();
    expect(a!.low).toBeLessThanOrEqual(a!.mid);
    expect(a!.mid).toBeLessThanOrEqual(a!.high);
  });

  it("anchors monthly from the same candidate set", () => {
    const set = [cand("a", 120000, 1), cand("b", 120000, 1), cand("c", 120000, 1)];
    const monthly = anchorFrom(set, (c) => c.monthlyPrice);
    expect(monthly).toEqual({ low: 10000, mid: 10000, high: 10000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/anchor.test.ts`
Expected: FAIL — `Cannot find module './anchor'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/anchor.ts`:

```ts
import type { Candidate } from "./comparables";

/** Below this there is no anchor. Two data points are an anecdote. */
export const MIN_CANDIDATES = 3;

export interface Anchor {
  low: number;
  mid: number;
  high: number;
}

/**
 * Weighted percentile: sort ascending by value, accumulate weight, and return
 * the value at which the running total first crosses the given fraction of the
 * total weight. A heavier candidate therefore pulls the percentile toward its
 * own price, which is how an own won deal outranks a published market number.
 */
export function weightedPercentile(
  points: { value: number; weight: number }[],
  fraction: number,
): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return sorted[0].value;

  const target = total * fraction;
  let running = 0;
  for (const p of sorted) {
    running += p.weight;
    if (running >= target) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

export function anchorFrom(
  candidates: Candidate[],
  pick: (c: Candidate) => number,
): Anchor | null {
  if (candidates.length < MIN_CANDIDATES) return null;
  const points = candidates.map((c) => ({ value: pick(c), weight: c.weight }));
  return {
    low: weightedPercentile(points, 0.25),
    mid: weightedPercentile(points, 0.5),
    high: weightedPercentile(points, 0.75),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/anchor.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/anchor.ts src/lib/pricing/anchor.test.ts
git commit -m "feat(pricing): weighted percentile anchor from matched comparables"
```

---

## Task 6: Floors, ceilings and the price-loss cap

**Files:**
- Create: `src/lib/pricing/bounds.ts`
- Test: `src/lib/pricing/bounds.test.ts`

**Interfaces:**
- Consumes: `Anchor` from Task 5, `Candidate` from Task 4, `CapexBand`/`Settings` from Task 1, `fmtCurrency` from `@/lib/utils`.
- Produces: `capexMultiplier(band, multipliers): number` and `computeBounds(params): Bounds` where

```ts
export interface Bounds {
  setup: { floor: number; ceiling: number } | null;
  monthly: { floor: number; ceiling: number };
  notes: string[];
}
```

Task 8 consumes both.

This is the task that decides what can never be quoted. `monthlyFloor` is the only bound that exists unconditionally, because opex is always known; everything else depends on an anchor. The capex multiplier is applied here rather than left to the model, because ability to pay is objective capacity — it is arithmetic, not judgement.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/bounds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBounds, capexMultiplier } from "./bounds";
import type { Candidate } from "./comparables";
import type { BuildAttributes, Settings } from "@/lib/types";

const MULT: Settings["capexMultipliers"] = { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 };

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: [], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

function loss(id: string, setupPrice: number): Candidate {
  return {
    source: "quote", id, label: id, attributes: ATTRS,
    setupPrice, monthlyPrice: 9000, outcomeWeight: 1, similarity: 0.8, weight: 0.8,
  };
}

const BASE = {
  opexTotal: 5000,
  targetMarginPct: 0.4,
  minimumSetupFee: 0,
  setupAnchor: { low: 90000, mid: 120000, high: 160000 },
  monthlyAnchor: { low: 7000, mid: 9000, high: 12000 },
  capexBand: "small" as const,
  multipliers: MULT,
  priceLosses: [] as Candidate[],
  currency: "ZAR" as const,
};

describe("capexMultiplier", () => {
  it("maps each band to its multiplier", () => {
    expect(capexMultiplier("micro", MULT)).toBe(0.7);
    expect(capexMultiplier("enterprise", MULT)).toBe(2.0);
  });
  it("treats an unknown band as neutral", () => {
    expect(capexMultiplier("unknown", MULT)).toBe(1);
  });
});

describe("computeBounds", () => {
  it("sets the monthly floor at opex plus target margin", () => {
    const b = computeBounds(BASE);
    expect(b.monthly.floor).toBe(7000); // 5000 × 1.4
  });

  it("never lets the monthly ceiling fall below 1.5× the floor", () => {
    const b = computeBounds({ ...BASE, monthlyAnchor: { low: 100, mid: 200, high: 300 } });
    expect(b.monthly.ceiling).toBe(10500); // 7000 × 1.5 beats 300 × 1.0
  });

  it("falls back to 1.5× the floor when there is no anchor at all", () => {
    const b = computeBounds({ ...BASE, setupAnchor: null, monthlyAnchor: null });
    expect(b.setup).toBeNull();
    expect(b.monthly.floor).toBe(7000);
    expect(b.monthly.ceiling).toBe(10500);
  });

  it("raises the setup floor to the minimum setup fee when that is higher", () => {
    expect(computeBounds(BASE).setup!.floor).toBe(90000);
    expect(computeBounds({ ...BASE, minimumSetupFee: 110000 }).setup!.floor).toBe(110000);
  });

  it("applies the capex multiplier to the setup ceiling", () => {
    expect(computeBounds({ ...BASE, capexBand: "enterprise" }).setup!.ceiling).toBe(320000);
    expect(computeBounds({ ...BASE, capexBand: "micro" }).setup!.ceiling).toBe(112000);
  });

  it("caps the ceiling at the lowest price-loss, and says whose", () => {
    const b = computeBounds({ ...BASE, priceLosses: [loss("Kestrelmoor", 140000), loss("Other", 155000)] });
    expect(b.setup!.ceiling).toBe(140000);
    expect(b.notes.join(" ")).toContain("Kestrelmoor");
    expect(b.notes.join(" ")).toContain("R140,000");
  });

  it("ignores a price-loss above the ceiling", () => {
    const b = computeBounds({ ...BASE, priceLosses: [loss("Rich", 900000)] });
    expect(b.setup!.ceiling).toBe(160000);
    expect(b.notes).toHaveLength(0);
  });

  it("lets the walk-away floor win when a price-loss cap lands below it", () => {
    const b = computeBounds({
      ...BASE,
      minimumSetupFee: 150000,
      priceLosses: [loss("Cheapskate", 60000)],
    });
    expect(b.setup!.floor).toBe(150000);
    expect(b.setup!.ceiling).toBe(150000);
    expect(b.notes.join(" ")).toContain("floor wins");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/bounds.test.ts`
Expected: FAIL — `Cannot find module './bounds'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/bounds.ts`:

```ts
import type { CapexBand, Settings } from "@/lib/types";
import { fmtCurrency } from "@/lib/utils";
import type { Anchor } from "./anchor";
import type { Candidate } from "./comparables";

export interface Bounds {
  /** null when there is no anchor — a setup fee cannot be invented. */
  setup: { floor: number; ceiling: number } | null;
  monthly: { floor: number; ceiling: number };
  notes: string[];
}

export interface BoundsParams {
  opexTotal: number;
  targetMarginPct: number;
  minimumSetupFee: number;
  setupAnchor: Anchor | null;
  monthlyAnchor: Anchor | null;
  capexBand: CapexBand;
  multipliers: Settings["capexMultipliers"];
  priceLosses: Candidate[];
  currency: Settings["currency"];
}

/** Ability to pay is objective capacity, so it is arithmetic rather than judgement. */
export function capexMultiplier(
  band: CapexBand,
  multipliers: Settings["capexMultipliers"],
): number {
  if (band === "unknown") return 1;
  return multipliers[band] ?? 1;
}

export function computeBounds(params: BoundsParams): Bounds {
  const {
    opexTotal, targetMarginPct, minimumSetupFee,
    setupAnchor, monthlyAnchor, capexBand, multipliers, priceLosses, currency,
  } = params;

  const notes: string[] = [];
  const mult = capexMultiplier(capexBand, multipliers);

  // The one bound that always exists: opex is always known.
  const monthlyFloor = Math.round(opexTotal * (1 + targetMarginPct));
  const monthlyCeiling = monthlyAnchor
    ? Math.max(Math.round(monthlyAnchor.high * mult), Math.round(monthlyFloor * 1.5))
    : Math.round(monthlyFloor * 1.5);

  if (!setupAnchor) {
    return { setup: null, monthly: { floor: monthlyFloor, ceiling: monthlyCeiling }, notes };
  }

  const setupFloor = Math.max(minimumSetupFee, Math.round(setupAnchor.low));
  let setupCeiling = Math.round(setupAnchor.high * mult);

  // A deal lost specifically on price is evidence about where resistance starts.
  const lowest = priceLosses.reduce<Candidate | null>(
    (best, c) => (best === null || c.setupPrice < best.setupPrice ? c : best),
    null,
  );
  if (lowest && lowest.setupPrice < setupCeiling) {
    setupCeiling = Math.round(lowest.setupPrice);
    notes.push(
      `Stretch capped at ${fmtCurrency(setupCeiling, currency)} — ${lowest.label} lost on price at that number.`,
    );
  }

  // A number someone refused does not make a loss-making deal worth taking.
  if (setupCeiling < setupFloor) {
    notes.push(
      `Price-loss cap of ${fmtCurrency(setupCeiling, currency)} sits below the walk-away floor of ${fmtCurrency(setupFloor, currency)}; the floor wins.`,
    );
    setupCeiling = setupFloor;
  }

  return {
    setup: { floor: setupFloor, ceiling: setupCeiling },
    monthly: { floor: monthlyFloor, ceiling: monthlyCeiling },
    notes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/bounds.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/bounds.ts src/lib/pricing/bounds.test.ts
git commit -m "feat(pricing): floors, capex ceilings and the price-loss cap"
```

---

## Task 7: Clamping a proposal into bounds

**Files:**
- Create: `src/lib/pricing/clamp.ts`
- Test: `src/lib/pricing/clamp.test.ts`

**Interfaces:**
- Consumes: `PriceTriple`, `Settings` from Task 1; `fmtCurrency` from `@/lib/utils`.
- Produces: `clampTriple(proposed: { target: number; stretch: number }, bounds: { floor: number; ceiling: number }, label: string, currency: Settings["currency"]): { triple: PriceTriple; notes: string[] }`. Tasks 8 and 11 consume it.

Every adjustment produces a sentence. A clamp the user cannot see is a number they cannot argue with.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/clamp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampTriple } from "./clamp";

const BOUNDS = { floor: 100000, ceiling: 160000 };

describe("clampTriple", () => {
  it("passes an in-range proposal through untouched", () => {
    const { triple, notes } = clampTriple({ target: 120000, stretch: 150000 }, BOUNDS, "Setup", "ZAR");
    expect(triple).toEqual({ floor: 100000, target: 120000, stretch: 150000 });
    expect(notes).toHaveLength(0);
  });

  it("pulls a stretch above the ceiling back down and says so", () => {
    const { triple, notes } = clampTriple({ target: 120000, stretch: 400000 }, BOUNDS, "Setup", "ZAR");
    expect(triple.stretch).toBe(160000);
    expect(notes[0]).toContain("Setup");
    expect(notes[0]).toContain("R160,000");
  });

  it("lifts a target below the floor", () => {
    const { triple, notes } = clampTriple({ target: 40000, stretch: 150000 }, BOUNDS, "Setup", "ZAR");
    expect(triple.target).toBe(100000);
    expect(notes.join(" ")).toContain("floor");
  });

  it("raises a stretch that sits below the target", () => {
    const { triple, notes } = clampTriple({ target: 150000, stretch: 110000 }, BOUNDS, "Monthly", "ZAR");
    expect(triple.stretch).toBe(150000);
    expect(notes.join(" ")).toContain("Monthly");
  });

  it("rounds to whole units", () => {
    const { triple } = clampTriple({ target: 120000.7, stretch: 150000.2 }, BOUNDS, "Setup", "ZAR");
    expect(triple.target).toBe(120001);
    expect(triple.stretch).toBe(150000);
  });

  it("collapses to the floor when floor and ceiling are equal", () => {
    const { triple } = clampTriple({ target: 5, stretch: 999 }, { floor: 50, ceiling: 50 }, "Setup", "ZAR");
    expect(triple).toEqual({ floor: 50, target: 50, stretch: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/clamp.test.ts`
Expected: FAIL — `Cannot find module './clamp'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/clamp.ts`:

```ts
import type { PriceTriple, Settings } from "@/lib/types";
import { fmtCurrency } from "@/lib/utils";

/**
 * Forces a proposed target/stretch into code-computed bounds, explaining every
 * adjustment. The model is allowed judgement inside the range and no authority
 * over the range itself — and a clamp the user cannot see is a number they
 * cannot argue with, so each one becomes a sentence.
 */
export function clampTriple(
  proposed: { target: number; stretch: number },
  bounds: { floor: number; ceiling: number },
  label: string,
  currency: Settings["currency"],
): { triple: PriceTriple; notes: string[] } {
  const notes: string[] = [];
  const money = (n: number) => fmtCurrency(n, currency);

  let target = Math.round(proposed.target);
  let stretch = Math.round(proposed.stretch);

  if (target < bounds.floor) {
    notes.push(`${label} target raised to the ${money(bounds.floor)} floor.`);
    target = bounds.floor;
  } else if (target > bounds.ceiling) {
    notes.push(`${label} target capped at the ${money(bounds.ceiling)} ceiling.`);
    target = bounds.ceiling;
  }

  if (stretch < bounds.floor) {
    notes.push(`${label} stretch raised to the ${money(bounds.floor)} floor.`);
    stretch = bounds.floor;
  } else if (stretch > bounds.ceiling) {
    notes.push(`${label} stretch capped at the ${money(bounds.ceiling)} ceiling.`);
    stretch = bounds.ceiling;
  }

  if (stretch < target) {
    notes.push(`${label} stretch raised to match the target at ${money(target)}.`);
    stretch = target;
  }

  return { triple: { floor: bounds.floor, target, stretch }, notes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/clamp.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/clamp.ts src/lib/pricing/clamp.test.ts
git commit -m "feat(pricing): clamp adjudicated prices into code-owned bounds"
```

---

## Task 8: Band assembly and every degraded path

**Files:**
- Create: `src/lib/pricing/band.ts`
- Test: `src/lib/pricing/band.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:

```ts
export interface Adjudication {
  setup: { target: number; stretch: number } | null;
  monthly: { target: number; stretch: number };
  reasoning: string;
}

export interface Prepared {
  opex: OpexResult;
  set: CandidateSet;
  setupAnchor: Anchor | null;
  monthlyAnchor: Anchor | null;
  bounds: Bounds;
  degraded: string[];
}

export function preparePricing(params: PrepareParams): Prepared;
export function buildBand(
  prepared: Prepared,
  adjudication: Adjudication | null,
  currency: Settings["currency"],
  now: string,
): PriceBand;
```

Tasks 11, 12 and 17 consume both functions. `now` is injected rather than read from the clock so the test can assert `computedAt` exactly.

The split matters: `preparePricing` produces the bounds that get *sent* to the adjudication route, and `buildBand` folds the answer back in. The model therefore never sees a request it could answer by widening its own constraints.

This is the task that makes the whole engine degrade rather than block. A pricing tool that refuses to produce a number because a web search timed out is worse than useless five minutes before a call.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/band.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preparePricing, buildBand } from "./band";
import type { BuildAttributes, Comparable, Quote, Settings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/seed";

const NOW = "2026-08-10T09:00:00.000Z";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  usdToZar: 18,
  minimumSetupFee: 50000,
  targetMarginPct: 0.4,
};

function comparable(id: string, setupPrice: number, monthlyPrice: number): Comparable {
  return {
    id, createdAt: "", updatedAt: "", kind: "market", name: `Vendor ${id}`,
    notes: "", sourceUrl: "", attributes: ATTRS, setupPrice, monthlyPrice, currency: "ZAR",
  };
}

const COMPARABLES = [
  comparable("a", 90000, 7000),
  comparable("b", 120000, 9000),
  comparable("c", 160000, 12000),
];

const BASE = {
  attributes: ATTRS,
  opexLines: [{ id: "h", label: "Hosting", monthlyCost: 5000 }],
  aiUsage: null,
  comparables: COMPARABLES,
  quotes: [] as Quote[],
  currentQuoteId: "current",
  settings: SETTINGS,
  intent: null,
  capex: null,
};

describe("preparePricing", () => {
  it("produces bounds and an anchor from three comparables", () => {
    const p = preparePricing(BASE);
    expect(p.setupAnchor).not.toBeNull();
    expect(p.bounds.setup).not.toBeNull();
    expect(p.bounds.monthly.floor).toBe(7000);
    expect(p.set.candidates).toHaveLength(3);
  });

  it("reports every missing input as a degrade code", () => {
    const p = preparePricing(BASE);
    expect(p.degraded).toContain("no-intent");
    expect(p.degraded).toContain("no-capex");
    expect(p.degraded).not.toContain("no-anchor");
  });

  it("reports no-anchor below three comparables", () => {
    const p = preparePricing({ ...BASE, comparables: COMPARABLES.slice(0, 2) });
    expect(p.setupAnchor).toBeNull();
    expect(p.bounds.setup).toBeNull();
    expect(p.degraded).toContain("no-anchor");
  });

  it("reports no-fx-rate when USD comparables were dropped", () => {
    const usd: Comparable = { ...comparable("u", 5000, 400), currency: "USD" };
    const p = preparePricing({
      ...BASE,
      settings: { ...SETTINGS, usdToZar: 0 },
      comparables: [...COMPARABLES, usd],
    });
    expect(p.degraded).toContain("no-fx-rate");
  });

  it("reports an unpriced AI model", () => {
    const p = preparePricing({
      ...BASE,
      aiUsage: {
        model: "gpt-hypothetical", runsPerDay: 10,
        inputTokensPerRun: 1000, outputTokensPerRun: 200,
        inputPriceOverride: null, outputPriceOverride: null,
      },
    });
    expect(p.degraded).toContain("unpriced-ai-model");
  });
});

describe("buildBand", () => {
  it("uses the adjudicated numbers when they sit inside the bounds", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: { target: 120000, stretch: 150000 }, monthly: { target: 9000, stretch: 11000 }, reasoning: "Strong signals." },
      "ZAR",
      NOW,
    );
    expect(band.setup!.target).toBe(120000);
    expect(band.setup!.stretch).toBe(150000);
    expect(band.monthly.target).toBe(9000);
    expect(band.reasoning).toBe("Strong signals.");
    expect(band.clamps).toHaveLength(0);
    expect(band.computedAt).toBe(NOW);
  });

  it("clamps an over-reaching proposal and records why", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: { target: 120000, stretch: 900000 }, monthly: { target: 9000, stretch: 11000 }, reasoning: "" },
      "ZAR",
      NOW,
    );
    expect(band.setup!.stretch).toBe(p.bounds.setup!.ceiling);
    expect(band.clamps.join(" ")).toContain("ceiling");
  });

  it("never quotes a monthly below the opex floor, whatever the model says", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: null, monthly: { target: 100, stretch: 200 }, reasoning: "" },
      "ZAR",
      NOW,
    );
    expect(band.monthly.target).toBe(7000);
    expect(band.monthly.floor).toBe(7000);
  });

  it("falls back deterministically when adjudication is missing", () => {
    const p = preparePricing(BASE);
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.degraded).toContain("no-adjudication");
    expect(band.setup!.target).toBe(p.setupAnchor!.mid);
    expect(band.setup!.stretch).toBe(p.bounds.setup!.ceiling);
    expect(band.monthly.target).toBe(Math.round(7000 * 1.15));
    expect(band.reasoning).toContain("without an adjudication");
  });

  it("produces a monthly band but no setup band when there is no anchor", () => {
    const p = preparePricing({ ...BASE, comparables: [] });
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.setup).toBeNull();
    expect(band.anchor).toBeNull();
    expect(band.monthly.floor).toBe(7000);
    expect(band.degraded).toContain("no-anchor");
  });

  it("lists anchor contributors in matched, and price-losses only in clamps", () => {
    const lostQuote: Quote = {
      id: "lost1", createdAt: "", updatedAt: "", leadId: "l1", name: "Kestrelmoor",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 140000, sentMonthly: 9000,
      closedSetup: 0, closedMonthly: 0, lostReason: "price", notes: "",
    };
    const p = preparePricing({ ...BASE, quotes: [lostQuote] });
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.matched.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(band.clamps.join(" ")).toContain("Kestrelmoor");
  });

  it("carries the capex multiplier through to the ceiling", () => {
    const enterprise = preparePricing({
      ...BASE,
      capex: {
        band: "enterprise", headcount: 900, revenueNote: "", evidence: [],
        confidence: "high", generatedAt: NOW,
      },
    });
    const small = preparePricing(BASE);
    expect(enterprise.bounds.setup!.ceiling).toBeGreaterThan(small.bounds.setup!.ceiling);
    expect(enterprise.degraded).not.toContain("no-capex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/band.test.ts`
Expected: FAIL — `Cannot find module './band'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/band.ts`:

```ts
import type {
  AiUsageLine, BuildAttributes, CapexRead, Comparable, IntentRead,
  MatchedComparable, OpexLine, PriceBand, Quote, Settings,
} from "@/lib/types";
import { monthlyOpex, type OpexResult } from "./opex";
import { buildCandidates, type CandidateSet } from "./comparables";
import { anchorFrom, type Anchor } from "./anchor";
import { computeBounds, type Bounds } from "./bounds";
import { clampTriple } from "./clamp";

/** What the adjudication route is allowed to decide: placement, never range. */
export interface Adjudication {
  setup: { target: number; stretch: number } | null;
  monthly: { target: number; stretch: number };
  reasoning: string;
}

export interface PrepareParams {
  attributes: BuildAttributes;
  opexLines: OpexLine[];
  aiUsage: AiUsageLine | null;
  comparables: Comparable[];
  quotes: Quote[];
  currentQuoteId: string;
  settings: Settings;
  intent: IntentRead | null;
  capex: CapexRead | null;
}

export interface Prepared {
  opex: OpexResult;
  set: CandidateSet;
  setupAnchor: Anchor | null;
  monthlyAnchor: Anchor | null;
  bounds: Bounds;
  degraded: string[];
}

/**
 * Everything the adjudication route needs, computed before it is asked. The
 * model receives the bounds rather than the ingredients, so there is no request
 * it could answer by widening its own constraints.
 */
export function preparePricing(params: PrepareParams): Prepared {
  const { settings } = params;
  const degraded: string[] = [];

  const opex = monthlyOpex(params.opexLines, params.aiUsage, settings.usdToZar);
  if (opex.unpricedModel) degraded.push("unpriced-ai-model");

  const set = buildCandidates({
    attributes: params.attributes,
    comparables: params.comparables,
    quotes: params.quotes,
    currentQuoteId: params.currentQuoteId,
    usdToZar: settings.usdToZar,
  });
  if (set.droppedForFx > 0) degraded.push("no-fx-rate");

  const setupAnchor = anchorFrom(set.candidates, (c) => c.setupPrice);
  const monthlyAnchor = anchorFrom(set.candidates, (c) => c.monthlyPrice);
  if (!setupAnchor) degraded.push("no-anchor");

  if (!params.intent) degraded.push("no-intent");
  if (!params.capex || params.capex.band === "unknown") degraded.push("no-capex");

  const bounds = computeBounds({
    opexTotal: opex.total,
    targetMarginPct: settings.targetMarginPct,
    minimumSetupFee: settings.minimumSetupFee,
    setupAnchor,
    monthlyAnchor,
    capexBand: params.capex?.band ?? "unknown",
    multipliers: settings.capexMultipliers,
    priceLosses: set.priceLosses,
    currency: settings.currency,
  });

  return { opex, set, setupAnchor, monthlyAnchor, bounds, degraded };
}

export function buildBand(
  prepared: Prepared,
  adjudication: Adjudication | null,
  currency: Settings["currency"],
  now: string,
): PriceBand {
  const { bounds, set, setupAnchor } = prepared;
  const degraded = [...prepared.degraded];
  const clamps = [...bounds.notes];

  // Bounds always win. A fallback that skipped clamping would be the one path
  // where an out-of-range number could reach the user.
  const monthlyProposal = adjudication
    ? adjudication.monthly
    : { target: bounds.monthly.floor * 1.15, stretch: bounds.monthly.ceiling };
  const monthly = clampTriple(monthlyProposal, bounds.monthly, "Monthly", currency);
  clamps.push(...monthly.notes);

  let setup: PriceBand["setup"] = null;
  if (bounds.setup && setupAnchor) {
    const setupProposal =
      adjudication?.setup ?? { target: setupAnchor.mid, stretch: bounds.setup.ceiling };
    const clamped = clampTriple(setupProposal, bounds.setup, "Setup", currency);
    clamps.push(...clamped.notes);
    setup = clamped.triple;
  }

  if (!adjudication) degraded.push("no-adjudication");

  const matched: MatchedComparable[] = set.candidates.map((c) => ({
    source: c.source,
    id: c.id,
    label: c.label,
    similarity: c.similarity,
    weight: c.weight,
  }));

  const reasoning =
    adjudication?.reasoning ||
    "Priced from the comparable anchor without an adjudication — the target sits at the " +
      "midpoint of matched comparables and the stretch at the ceiling.";

  return {
    setup,
    monthly: monthly.triple,
    anchor: setupAnchor,
    matched,
    clamps,
    degraded,
    reasoning,
    computedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/band.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Run the whole engine suite**

Run: `npx vitest run src/lib/pricing`
Expected: PASS — every engine test from Tasks 1–8.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/band.ts src/lib/pricing/band.test.ts
git commit -m "feat(pricing): assemble the price band with degraded fallbacks"
```

---

## Task 9: Normalising model output

**Files:**
- Create: `src/lib/pricing/normalize.ts`
- Test: `src/lib/pricing/normalize.test.ts`

**Interfaces:**
- Consumes: `IntentRead`, `CapexRead`, `CapexBand` from Task 1; `Adjudication` from Task 8.
- Produces: `normalizeIntent(raw: Record<string, unknown>, now: string): IntentRead`, `normalizeCapex(raw: Record<string, unknown>, now: string): CapexRead`, `normalizeAdjudication(raw: Record<string, unknown>): Adjudication`. Tasks 10, 11 and 12 each import one.

This follows the `src/lib/prep/normalize.ts` pattern: the route owns the API call, a pure module owns the shape of what comes back, and the pure module is where the tests live. A forced tool call constrains the schema but not the *sense* of the values — a score of 3000, a `band` the model invented, an evidence entry with no URL. Every one of those becomes a wrong price if it reaches the engine.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeIntent, normalizeCapex, normalizeAdjudication } from "./normalize";

const NOW = "2026-08-10T09:00:00.000Z";

describe("normalizeIntent", () => {
  it("keeps a well-formed read intact", () => {
    const r = normalizeIntent(
      {
        score: 78,
        band: "hot",
        signals: [{ quote: "We need this before year end", weight: 0.9 }],
        risks: ["Procurement is slow"],
      },
      NOW,
    );
    expect(r.score).toBe(78);
    expect(r.band).toBe("hot");
    expect(r.signals).toHaveLength(1);
    expect(r.generatedAt).toBe(NOW);
  });

  it("clamps a score outside 0-100", () => {
    expect(normalizeIntent({ score: 3000 }, NOW).score).toBe(100);
    expect(normalizeIntent({ score: -5 }, NOW).score).toBe(0);
  });

  it("derives the band from the score when the model invents one", () => {
    expect(normalizeIntent({ score: 20, band: "scorching" }, NOW).band).toBe("cold");
    expect(normalizeIntent({ score: 50 }, NOW).band).toBe("warm");
    expect(normalizeIntent({ score: 90 }, NOW).band).toBe("hot");
  });

  it("drops signals with no quoted evidence", () => {
    const r = normalizeIntent(
      { score: 50, signals: [{ quote: "", weight: 1 }, { weight: 1 }, { quote: "Real quote", weight: 5 }] },
      NOW,
    );
    expect(r.signals).toEqual([{ quote: "Real quote", weight: 1 }]);
  });

  it("survives a completely empty payload", () => {
    const r = normalizeIntent({}, NOW);
    expect(r.score).toBe(0);
    expect(r.band).toBe("cold");
    expect(r.signals).toEqual([]);
    expect(r.risks).toEqual([]);
  });
});

describe("normalizeCapex", () => {
  it("keeps a well-formed read intact", () => {
    const r = normalizeCapex(
      {
        band: "mid",
        headcount: 140,
        revenueNote: "R400m AUM",
        evidence: [{ claim: "140 staff", url: "https://example.com/about" }],
        confidence: "high",
      },
      NOW,
    );
    expect(r.band).toBe("mid");
    expect(r.headcount).toBe(140);
    expect(r.evidence).toHaveLength(1);
    expect(r.confidence).toBe("high");
  });

  it("falls back to unknown for a band it does not recognise", () => {
    expect(normalizeCapex({ band: "enormous" }, NOW).band).toBe("unknown");
    expect(normalizeCapex({}, NOW).band).toBe("unknown");
  });

  it("drops evidence with no source URL", () => {
    const r = normalizeCapex(
      { band: "mid", evidence: [{ claim: "Big" }, { claim: "Real", url: "https://x.com" }] },
      NOW,
    );
    expect(r.evidence).toEqual([{ claim: "Real", url: "https://x.com" }]);
  });

  it("defaults confidence to low rather than assuming", () => {
    expect(normalizeCapex({ band: "mid", confidence: "certain" }, NOW).confidence).toBe("low");
  });

  it("treats a non-numeric headcount as unknown", () => {
    expect(normalizeCapex({ band: "mid", headcount: "lots" }, NOW).headcount).toBeNull();
  });
});

describe("normalizeAdjudication", () => {
  it("keeps well-formed numbers", () => {
    const a = normalizeAdjudication({
      setup: { target: 120000, stretch: 150000 },
      monthly: { target: 9000, stretch: 11000 },
      reasoning: "Because.",
    });
    expect(a.setup).toEqual({ target: 120000, stretch: 150000 });
    expect(a.monthly).toEqual({ target: 9000, stretch: 11000 });
    expect(a.reasoning).toBe("Because.");
  });

  it("returns a null setup when the numbers are not usable", () => {
    expect(normalizeAdjudication({ monthly: { target: 9000, stretch: 11000 } }).setup).toBeNull();
    expect(normalizeAdjudication({ setup: { target: "lots" }, monthly: {} }).setup).toBeNull();
  });

  it("zeroes an unusable monthly so the floor clamp catches it", () => {
    const a = normalizeAdjudication({});
    expect(a.monthly).toEqual({ target: 0, stretch: 0 });
    expect(a.reasoning).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/normalize.ts`:

```ts
/* ============================================================
   Model output → engine input.

   A forced tool call constrains the schema but not the sense of the
   values. A score of 3000, an invented band, an evidence entry with no
   URL — each becomes a wrong price if it reaches the engine, so every
   field is re-derived or discarded here.
   ============================================================ */

import type { CapexBand, CapexRead, IntentRead } from "@/lib/types";
import type { Adjudication } from "./band";

const CAPEX_BANDS: CapexBand[] = ["unknown", "micro", "small", "mid", "enterprise"];
const CONFIDENCES = ["low", "medium", "high"] as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];
}

export function normalizeIntent(raw: Record<string, unknown>, now: string): IntentRead {
  const score = clamp(Math.round(num(raw.score) ?? 0), 0, 100);

  // The band is re-derived rather than trusted: it must agree with the score,
  // because the score is what the founder reads off the card.
  const band: IntentRead["band"] = score < 34 ? "cold" : score < 67 ? "warm" : "hot";

  const signals = rows(raw.signals)
    .map((s) => ({ quote: str(s.quote), weight: clamp(num(s.weight) ?? 0, 0, 1) }))
    .filter((s) => s.quote.length > 0);

  const risks = Array.isArray(raw.risks)
    ? raw.risks.map(str).filter((s) => s.length > 0)
    : [];

  return { score, band, signals, risks, generatedAt: now };
}

export function normalizeCapex(raw: Record<string, unknown>, now: string): CapexRead {
  const rawBand = str(raw.band) as CapexBand;
  const band = CAPEX_BANDS.includes(rawBand) ? rawBand : "unknown";

  const rawConfidence = str(raw.confidence) as CapexRead["confidence"];
  const confidence = (CONFIDENCES as readonly string[]).includes(rawConfidence)
    ? rawConfidence
    : "low";

  // An unsourced claim about a client's balance sheet is a guess wearing a
  // citation's clothes — drop it rather than let it move the ceiling.
  const evidence = rows(raw.evidence)
    .map((e) => ({ claim: str(e.claim), url: str(e.url) }))
    .filter((e) => e.url.length > 0);

  return {
    band,
    headcount: num(raw.headcount),
    revenueNote: str(raw.revenueNote),
    evidence,
    confidence,
    generatedAt: now,
  };
}

export function normalizeAdjudication(raw: Record<string, unknown>): Adjudication {
  const pair = (v: unknown): { target: number; stretch: number } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const target = num(o.target);
    const stretch = num(o.stretch);
    return target === null || stretch === null ? null : { target, stretch };
  };

  return {
    setup: pair(raw.setup),
    // A zeroed monthly is safe: clampTriple lifts it to the opex floor.
    monthly: pair(raw.monthly) ?? { target: 0, stretch: 0 },
    reasoning: str(raw.reasoning),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/normalize.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/normalize.ts src/lib/pricing/normalize.test.ts
git commit -m "feat(pricing): normalise model output before it reaches the engine"
```

---

## Task 10: Buying-intent route

**Files:**
- Create: `src/app/api/pricing/intent/route.ts`
- Test: `src/lib/pricing/intentContext.test.ts`
- Create: `src/lib/pricing/intentContext.ts`

**Interfaces:**
- Consumes: `normalizeIntent` from Task 9; `loadAll` from `@/lib/db/sqlite`; `apiError`, `UPSTREAM_FAILED` from `@/lib/api/errors`.
- Produces: `POST /api/pricing/intent` accepting `{ leadId: string }` and returning an `IntentRead`; plus `buildIntentContext(data: DataShape, leadId: string): IntentContext | null` for testing.

The CRM never travels from the browser. The client sends a `leadId`; the route loads the database server-side, exactly as `/api/data` does. Every signal must quote text that actually exists in a record, so a score of 80 can always be traced to something a person said.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/intentContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildIntentContext } from "./intentContext";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { DataShape, Interaction, Lead } from "@/lib/types";

const lead: Lead = {
  id: "l1", createdAt: "", updatedAt: "",
  company: "Quillmere Capital", contactName: "Johan", contactRole: "MD",
  email: "", phone: "", linkedinUrl: "", industry: "Asset Management",
  companyType: "Boutique fund manager", source: "referral", status: "interested",
  quality: "high", painPoint: "Reports take three days",
  objection: "Worried about data security", buyingSignal: "Asked about timelines",
  lastContact: "2026-08-01", nextFollowUp: null, notes: "", solutionIdea: "",
  estimatedValue: 120000, owner: "Emil",
};

function interaction(over: Partial<Interaction>): Interaction {
  return {
    id: "i1", createdAt: "", updatedAt: "", leadId: "l1",
    company: "Quillmere Capital", contact: "Johan", date: "2026-08-01",
    type: "call", rawNotes: "", whatTheySaid: "We want this live by Q4",
    painPoints: "Manual Excel work", objections: "", buyingSignals: "Asked for pricing",
    followUpRequired: false, followUpDate: null, ...over,
  };
}

const DATA = {
  leads: [lead],
  interactions: [interaction({}), interaction({ id: "i2", leadId: "other" })],
  projects: [], tasks: [], scorecards: [], painPoints: [], conversations: [],
  playbooks: [], targets: [], dialLists: [], positioningProfiles: [],
  voiceSamples: [], voiceProfile: [], contentThreads: [], brainThreads: [],
  newsFeed: [], newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
  milestones: [], projectThreads: [], quotes: [], comparables: [],
  settings: DEFAULT_SETTINGS,
} as DataShape;

describe("buildIntentContext", () => {
  it("returns null for a lead that does not exist", () => {
    expect(buildIntentContext(DATA, "nope")).toBeNull();
  });

  it("gathers the lead's own signal fields", () => {
    const ctx = buildIntentContext(DATA, "l1")!;
    expect(ctx.company).toBe("Quillmere Capital");
    expect(ctx.painPoint).toBe("Reports take three days");
    expect(ctx.objection).toBe("Worried about data security");
    expect(ctx.quality).toBe("high");
  });

  it("includes only interactions belonging to that lead", () => {
    const ctx = buildIntentContext(DATA, "l1")!;
    expect(ctx.interactions).toHaveLength(1);
    expect(ctx.interactions[0].whatTheySaid).toBe("We want this live by Q4");
  });

  it("orders interactions newest first so recency is legible to the model", () => {
    const data = {
      ...DATA,
      interactions: [
        interaction({ id: "old", date: "2026-01-01" }),
        interaction({ id: "new", date: "2026-08-01" }),
      ],
    } as DataShape;
    expect(buildIntentContext(data, "l1")!.interactions[0].date).toBe("2026-08-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/intentContext.test.ts`
Expected: FAIL — `Cannot find module './intentContext'`.

- [ ] **Step 3: Write the context builder**

Create `src/lib/pricing/intentContext.ts`:

```ts
import type { DataShape } from "@/lib/types";

export interface IntentInteraction {
  date: string;
  type: string;
  whatTheySaid: string;
  painPoints: string;
  objections: string;
  buyingSignals: string;
}

export interface IntentContext {
  company: string;
  contactRole: string;
  industry: string;
  status: string;
  quality: string;
  painPoint: string;
  objection: string;
  buyingSignal: string;
  lastContact: string | null;
  estimatedValue: number;
  interactions: IntentInteraction[];
}

/** Assembled server-side from a leadId — CRM text never travels from the browser. */
export function buildIntentContext(data: DataShape, leadId: string): IntentContext | null {
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return null;

  const interactions = data.interactions
    .filter((i) => i.leadId === leadId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((i) => ({
      date: i.date,
      type: i.type,
      whatTheySaid: i.whatTheySaid,
      painPoints: i.painPoints,
      objections: i.objections,
      buyingSignals: i.buyingSignals,
    }));

  return {
    company: lead.company,
    contactRole: lead.contactRole,
    industry: lead.industry,
    status: lead.status,
    quality: lead.quality,
    painPoint: lead.painPoint,
    objection: lead.objection,
    buyingSignal: lead.buyingSignal,
    lastContact: lead.lastContact,
    estimatedValue: lead.estimatedValue,
    interactions,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/intentContext.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write the route**

Create `src/app/api/pricing/intent/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { loadAll } from "@/lib/db/sqlite";
import { buildIntentContext } from "@/lib/pricing/intentContext";
import { normalizeIntent } from "@/lib/pricing/normalize";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_intent",
  description: "Save the buying-intent read for this lead.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description: "Buying intent from 0 (no interest) to 100 (ready to sign).",
      },
      band: { type: "string", enum: ["cold", "warm", "hot"] },
      signals: {
        type: "array",
        description:
          "Evidence for the score. Every quote must be text that appears verbatim in the supplied records — never a paraphrase.",
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "Verbatim text from a record." },
            weight: { type: "number", description: "0-1: how much this moved the score." },
          },
          required: ["quote", "weight"],
        },
      },
      risks: {
        type: "array",
        description: "What could stall or kill this deal.",
        items: { type: "string" },
      },
    },
    required: ["score", "band", "signals", "risks"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let leadId = "";
  try {
    ({ leadId } = (await req.json()) as { leadId: string });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!leadId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const data = await loadAll();
    const ctx = buildIntentContext(data, leadId);
    if (!ctx) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

    const system =
      "You read a B2B sales CRM and judge how badly this client wants to buy. " +
      "Score only on evidence present in the records — a quiet record is a low score, not a guess. " +
      "Every signal you cite must quote the record verbatim so the founder can trace the score back to " +
      "something a person actually said. Weigh recent interactions above old ones, explicit budget or " +
      "deadline talk above general enthusiasm, and treat unanswered objections as risk.";

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      output_config: { effort: "low" },
      tools: [saveTool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_intent" },
      messages: [
        {
          role: "user",
          content: `Read this lead and its interaction history, then save the intent read.\n\n${JSON.stringify(ctx, null, 2)}`,
        },
      ],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    if (!toolUse) return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "generation_incomplete" }, { status: 502 });
    }

    return NextResponse.json(
      normalizeIntent(toolUse.input as Record<string, unknown>, nowISO()),
    );
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
```

- [ ] **Step 6: Verify the route compiles and answers**

Run: `npx tsc --noEmit`
Expected: no type errors.

Then start the dev server (`npm run dev`) and run:

```bash
curl -s localhost:3000/api/pricing/intent | jq
```

Expected: `{"configured": true, "model": "claude-sonnet-5"}` — or `configured: false` if no key is set locally, which is also a pass for this step.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing/intentContext.ts src/lib/pricing/intentContext.test.ts src/app/api/pricing/intent/route.ts
git commit -m "feat(pricing): buying-intent route reading the CRM server-side"
```

---

## Task 11: Capex research route

**Files:**
- Create: `src/app/api/pricing/capex/route.ts`
- Create: `src/lib/pricing/capexQuery.ts`
- Test: `src/lib/pricing/capexQuery.test.ts`

**Interfaces:**
- Consumes: `normalizeCapex` from Task 9.
- Produces: `POST /api/pricing/capex` accepting `{ company, industry, companyType }` and returning a `CapexRead`; plus `capexQuery(params): string`.

This is the one route that cannot use a forced `tool_choice` — forcing the save tool would fire it before `web_search` ever runs. It follows `brain/route.ts` instead: both tools offered under automatic choice, looping while `stop_reason === "pause_turn"` (the server-side search loop pausing at its iteration cap), and pushing the assistant turn back unchanged. **Do not append a "continue" user message on a pause** — the API resumes from the trailing `server_tool_use` block on its own, and an extra turn confuses it.

Use `web_search_20260209`, the dynamic-filtering variant supported on Sonnet 5, not the `web_search_20250305` that `content/route.ts` and `brain/route.ts` use. It filters results before they reach context, which matters here because company-research results are long and mostly irrelevant.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/capexQuery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { capexQuery } from "./capexQuery";

describe("capexQuery", () => {
  it("leads with the company name", () => {
    const q = capexQuery({ company: "Quillmere Capital", industry: "Asset Management", companyType: "Boutique fund manager" });
    expect(q).toContain("Quillmere Capital");
    expect(q).toContain("Asset Management");
    expect(q).toContain("Boutique fund manager");
  });

  it("omits blank fields rather than emitting empty labels", () => {
    const q = capexQuery({ company: "Acme", industry: "", companyType: "" });
    expect(q).toContain("Acme");
    expect(q).not.toContain("Industry:");
    expect(q).not.toContain("Type:");
  });

  it("returns an empty string with no company, so the route can reject early", () => {
    expect(capexQuery({ company: "  ", industry: "x", companyType: "y" })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/capexQuery.test.ts`
Expected: FAIL — `Cannot find module './capexQuery'`.

- [ ] **Step 3: Write the query builder**

Create `src/lib/pricing/capexQuery.ts`:

```ts
export interface CapexQueryParams {
  company: string;
  industry: string;
  companyType: string;
}

/** Empty when there is no company to research — the route rejects rather than
    burning a web search on a blank name. */
export function capexQuery(params: CapexQueryParams): string {
  const company = params.company.trim();
  if (!company) return "";

  const lines = [`Company: ${company}`];
  if (params.industry.trim()) lines.push(`Industry: ${params.industry.trim()}`);
  if (params.companyType.trim()) lines.push(`Type: ${params.companyType.trim()}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/capexQuery.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write the route**

Create `src/app/api/pricing/capex/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { capexQuery, type CapexQueryParams } from "@/lib/pricing/capexQuery";
import { normalizeCapex } from "@/lib/pricing/normalize";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";
/** Search pauses its server-side loop; this bounds how many times we resume. */
const MAX_TURNS = 6;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_capex",
  description: "Save the researched spending capacity for this company.",
  input_schema: {
    type: "object" as const,
    properties: {
      band: {
        type: "string",
        enum: ["unknown", "micro", "small", "mid", "enterprise"],
        description:
          "micro: under ~10 staff or clearly pre-revenue. small: ~10-50. mid: ~50-500 or an established firm with real budget. enterprise: 500+ or a large institution. unknown when the evidence does not support a call.",
      },
      headcount: { type: "number", description: "Approximate staff count, if found." },
      revenueNote: {
        type: "string",
        description: "Revenue, AUM or funding in one short phrase, if found.",
      },
      evidence: {
        type: "array",
        description: "Every claim with the URL it came from. No URL, no claim.",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            url: { type: "string" },
          },
          required: ["claim", "url"],
        },
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["band", "evidence", "confidence"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: CapexQueryParams;
  try {
    body = (await req.json()) as CapexQueryParams;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const query = capexQuery(body);
  if (!query) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const system =
    "You research how much a company can afford to spend on software. Search the web, then save " +
    "a capacity band with the sources behind it. Report only what you can cite — an unsourced guess " +
    "about a client's balance sheet is worse than admitting you found nothing, because it will move " +
    "a real price. If the company is too small or too private to read, save band \"unknown\" with " +
    "confidence \"low\" and whatever partial evidence you did find.";

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Research this company's spending capacity, then call save_capex.\n\n${query}` },
  ];

  try {
    const client = new Anthropic({ apiKey });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        output_config: { effort: "medium" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          saveTool,
        ] as unknown as Anthropic.Tool[],
        messages,
      });

      const saved = response.content.find(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" && blk.name === "save_capex",
      );
      if (saved) {
        return NextResponse.json(
          normalizeCapex(saved.input as Record<string, unknown>, nowISO()),
        );
      }

      messages.push({ role: "assistant", content: response.content });

      // The server-side search loop hit its iteration cap. Re-request as-is —
      // the API resumes from the trailing server_tool_use block, and an extra
      // user turn here derails it.
      if (response.stop_reason === "pause_turn") continue;

      // It stopped without saving. Ask once, plainly, then let the loop bound it.
      messages.push({
        role: "user",
        content:
          "Call save_capex now with your best assessment. If the research was inconclusive, " +
          'use band "unknown" with confidence "low".',
      });
    }

    return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
```

- [ ] **Step 6: Verify it compiles and answers**

Run: `npx tsc --noEmit`
Expected: no type errors.

With `npm run dev` running and an `ANTHROPIC_API_KEY` set:

```bash
curl -s localhost:3000/api/pricing/capex \
  -H 'content-type: application/json' \
  -d '{"company":"Anthropic","industry":"AI","companyType":"Research lab"}' | jq
```

Expected: a `CapexRead` with a non-`unknown` band and at least one evidence entry carrying a URL. This is a real outbound search and costs a few cents.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing/capexQuery.ts src/lib/pricing/capexQuery.test.ts src/app/api/pricing/capex/route.ts
git commit -m "feat(pricing): capex research route with cited web search"
```

---

## Task 12: Adjudication route

**Files:**
- Create: `src/app/api/pricing/adjudicate/route.ts`
- Test: `src/lib/pricing/adjudicateBrief.test.ts`
- Create: `src/lib/pricing/adjudicateBrief.ts`

**Interfaces:**
- Consumes: `normalizeAdjudication` from Task 9, `Bounds` from Task 6, `Anchor` from Task 5, `MatchedComparable`/`IntentRead`/`CapexRead` from Task 1.
- Produces: `POST /api/pricing/adjudicate` accepting `AdjudicateRequest` and returning an `Adjudication`; plus `adjudicateBrief(req: AdjudicateRequest): string`.

```ts
export interface AdjudicateRequest {
  company: string;
  bounds: Bounds;
  anchor: Anchor | null;
  matched: MatchedComparable[];
  intent: IntentRead | null;
  capex: CapexRead | null;
  buildStatus: BuildStatus;
}
```

The model receives the **bounds**, not the ingredients that produced them. It places target and stretch inside; Task 8's clamp is the backstop, not the plan.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/adjudicateBrief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adjudicateBrief } from "./adjudicateBrief";
import type { AdjudicateRequest } from "./adjudicateBrief";

const REQ: AdjudicateRequest = {
  company: "Quillmere Capital",
  bounds: {
    setup: { floor: 90000, ceiling: 160000 },
    monthly: { floor: 7000, ceiling: 12000 },
    notes: [],
  },
  anchor: { low: 90000, mid: 120000, high: 160000 },
  matched: [{ source: "quote", id: "q1", label: "Acme build", similarity: 0.82, weight: 0.82 }],
  intent: {
    score: 78, band: "hot",
    signals: [{ quote: "We need this before year end", weight: 0.9 }],
    risks: ["Procurement is slow"], generatedAt: "",
  },
  capex: {
    band: "mid", headcount: 140, revenueNote: "R400m AUM",
    evidence: [{ claim: "140 staff", url: "https://x.com" }],
    confidence: "high", generatedAt: "",
  },
  buildStatus: "new",
};

describe("adjudicateBrief", () => {
  it("states both ranges explicitly", () => {
    const b = adjudicateBrief(REQ);
    expect(b).toContain("90000");
    expect(b).toContain("160000");
    expect(b).toContain("7000");
    expect(b).toContain("12000");
  });

  it("passes the intent evidence through verbatim", () => {
    expect(adjudicateBrief(REQ)).toContain("We need this before year end");
  });

  it("says plainly when a read is missing rather than omitting it", () => {
    const b = adjudicateBrief({ ...REQ, intent: null, capex: null });
    expect(b).toContain("No intent read");
    expect(b).toContain("No capex read");
  });

  it("flags a licensing deal so the model knows the floor is not a build cost", () => {
    expect(adjudicateBrief({ ...REQ, buildStatus: "license as-is" })).toContain("already built");
  });

  it("says there is no setup range when there is no anchor", () => {
    const b = adjudicateBrief({
      ...REQ,
      anchor: null,
      bounds: { setup: null, monthly: REQ.bounds.monthly, notes: [] },
    });
    expect(b).toContain("no setup range");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/adjudicateBrief.test.ts`
Expected: FAIL — `Cannot find module './adjudicateBrief'`.

- [ ] **Step 3: Write the brief builder**

Create `src/lib/pricing/adjudicateBrief.ts`:

```ts
import type {
  BuildStatus, CapexRead, IntentRead, MatchedComparable,
} from "@/lib/types";
import type { Anchor } from "./anchor";
import type { Bounds } from "./bounds";

export interface AdjudicateRequest {
  company: string;
  bounds: Bounds;
  anchor: Anchor | null;
  matched: MatchedComparable[];
  intent: IntentRead | null;
  capex: CapexRead | null;
  buildStatus: BuildStatus;
}

export function adjudicateBrief(req: AdjudicateRequest): string {
  const parts: string[] = [`Client: ${req.company}`];

  if (req.bounds.setup && req.anchor) {
    parts.push(
      `Setup range: ${req.bounds.setup.floor} to ${req.bounds.setup.ceiling}. ` +
        `Comparable anchor: low ${req.anchor.low}, mid ${req.anchor.mid}, high ${req.anchor.high}.`,
    );
  } else {
    parts.push("Setup: no setup range — too few comparables to anchor one. Return setup as null.");
  }

  parts.push(`Monthly range: ${req.bounds.monthly.floor} to ${req.bounds.monthly.ceiling}. ` +
    `The floor is running cost plus the founder's target margin and is not negotiable.`);

  if (req.buildStatus === "license as-is") {
    parts.push(
      "This solution is already built, so the setup fee recovers no build cost — the whole range is margin. " +
        "That does not make it worth less to the client; price it on value, not on effort saved.",
    );
  } else if (req.buildStatus === "adapt existing") {
    parts.push("This adapts an existing solution rather than starting from scratch.");
  }

  if (req.matched.length) {
    parts.push(
      "Matched comparables:\n" +
        req.matched
          .map((m) => `- ${m.label} (${m.source}, similarity ${m.similarity.toFixed(2)})`)
          .join("\n"),
    );
  }

  parts.push(
    req.intent
      ? `Buying intent: ${req.intent.score}/100 (${req.intent.band}).\nSignals:\n` +
          req.intent.signals.map((s) => `- "${s.quote}"`).join("\n") +
          (req.intent.risks.length ? `\nRisks:\n${req.intent.risks.map((r) => `- ${r}`).join("\n")}` : "")
      : "No intent read available — do not assume enthusiasm you have no evidence for.",
  );

  parts.push(
    req.capex
      ? `Capex band: ${req.capex.band} (confidence ${req.capex.confidence}).` +
          (req.capex.headcount ? ` Headcount ~${req.capex.headcount}.` : "") +
          (req.capex.revenueNote ? ` ${req.capex.revenueNote}.` : "")
      : "No capex read available — the ceiling has not been adjusted for capacity.",
  );

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/adjudicateBrief.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write the route**

Create `src/app/api/pricing/adjudicate/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { adjudicateBrief, type AdjudicateRequest } from "@/lib/pricing/adjudicateBrief";
import { normalizeAdjudication } from "@/lib/pricing/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_price",
  description: "Save the recommended target and stretch prices.",
  input_schema: {
    type: "object" as const,
    properties: {
      setup: {
        type: "object",
        description: "Omit entirely when the brief says there is no setup range.",
        properties: {
          target: { type: "number", description: "What to quote. Must sit inside the setup range." },
          stretch: { type: "number", description: "What to try if intent is strong. At or above target." },
        },
        required: ["target", "stretch"],
      },
      monthly: {
        type: "object",
        properties: {
          target: { type: "number", description: "Must sit inside the monthly range." },
          stretch: { type: "number", description: "At or above target." },
        },
        required: ["target", "stretch"],
      },
      reasoning: {
        type: "string",
        description:
          "Two or three sentences: what in the evidence justifies this placement. Name the specific signal or comparable, not the general shape of the deal.",
      },
    },
    required: ["monthly", "reasoning"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: AdjudicateRequest;
  try {
    body = (await req.json()) as AdjudicateRequest;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.bounds?.monthly) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const system =
    "You price a deal for a solo B2B software founder. You are given ranges that are already decided — " +
    "your job is placement inside them, never the ranges themselves. Numbers outside the given range are " +
    "discarded, so proposing one wastes the turn. Place the target where the evidence says the client " +
    "will actually say yes, and the stretch where they might if intent is strong. Strong, recent, " +
    "specific buying signals and a large capex band push both up; unanswered objections, a stale last " +
    "contact, or a thin evidence base pull them toward the floor. Absence of evidence is not evidence " +
    "of enthusiasm.";

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      output_config: { effort: "high" },
      tools: [saveTool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_price" },
      messages: [{ role: "user", content: adjudicateBrief(body) }],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    if (!toolUse) return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "generation_incomplete" }, { status: 502 });
    }

    return NextResponse.json(normalizeAdjudication(toolUse.input as Record<string, unknown>));
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, full suite passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing/adjudicateBrief.ts src/lib/pricing/adjudicateBrief.test.ts src/app/api/pricing/adjudicate/route.ts
git commit -m "feat(pricing): adjudication route bounded by code-owned ranges"
```

---

## Task 13: Client adapter and the recompute orchestrator

**Files:**
- Create: `src/lib/pricingClient.ts`
- Test: `src/lib/pricing/recompute.test.ts`
- Create: `src/lib/pricing/recompute.ts`

**Interfaces:**
- Consumes: `preparePricing`, `buildBand`, `Adjudication`, `Prepared` from Task 8; `AdjudicateRequest` from Task 12; `CapexQueryParams` from Task 11.
- Produces:

```ts
// pricingClient.ts — I/O only
export async function getPricingStatus(): Promise<{ configured: boolean }>;
export async function fetchIntent(leadId: string): Promise<IntentRead>;
export async function fetchCapex(params: CapexQueryParams): Promise<CapexRead>;
export async function fetchAdjudication(req: AdjudicateRequest): Promise<Adjudication>;

// recompute.ts — pure
export function adjudicateRequestFrom(
  company: string,
  buildStatus: BuildStatus,
  prepared: Prepared,
  intent: IntentRead | null,
  capex: CapexRead | null,
): AdjudicateRequest;
```

Tasks 17 and 18 consume both. The split keeps the request-shaping testable without a network: `recompute.ts` builds what gets sent, `pricingClient.ts` sends it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/recompute.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preparePricing } from "./band";
import { adjudicateRequestFrom } from "./recompute";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { BuildAttributes, Comparable, Settings } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, usdToZar: 18, targetMarginPct: 0.4 };

function comparable(id: string, setupPrice: number): Comparable {
  return {
    id, createdAt: "", updatedAt: "", kind: "market", name: `Vendor ${id}`,
    notes: "", sourceUrl: "", attributes: ATTRS,
    setupPrice, monthlyPrice: setupPrice / 14, currency: "ZAR",
  };
}

const PREPARED = preparePricing({
  attributes: ATTRS,
  opexLines: [{ id: "h", label: "Hosting", monthlyCost: 5000 }],
  aiUsage: null,
  comparables: [comparable("a", 90000), comparable("b", 120000), comparable("c", 160000)],
  quotes: [],
  currentQuoteId: "current",
  settings: SETTINGS,
  intent: null,
  capex: null,
});

describe("adjudicateRequestFrom", () => {
  it("sends bounds and the anchor, never the raw candidate prices", () => {
    const req = adjudicateRequestFrom("Quillmere Capital", "new", PREPARED, null, null);
    expect(req.bounds.setup).toEqual(PREPARED.bounds.setup);
    expect(req.anchor).toEqual(PREPARED.setupAnchor);
    const blob = JSON.stringify(req);
    expect(blob).not.toContain("setupPrice");
  });

  it("passes matched comparables as labels and scores only", () => {
    const req = adjudicateRequestFrom("Acme", "new", PREPARED, null, null);
    expect(req.matched).toHaveLength(3);
    expect(Object.keys(req.matched[0]).sort()).toEqual(
      ["id", "label", "similarity", "source", "weight"],
    );
  });

  it("carries the build status through so licensing is visible", () => {
    expect(adjudicateRequestFrom("Acme", "license as-is", PREPARED, null, null).buildStatus)
      .toBe("license as-is");
  });

  it("passes null reads through rather than inventing empty ones", () => {
    const req = adjudicateRequestFrom("Acme", "new", PREPARED, null, null);
    expect(req.intent).toBeNull();
    expect(req.capex).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing/recompute.test.ts`
Expected: FAIL — `Cannot find module './recompute'`.

- [ ] **Step 3: Write the request builder**

Create `src/lib/pricing/recompute.ts`:

```ts
import type { BuildStatus, CapexRead, IntentRead, MatchedComparable } from "@/lib/types";
import type { AdjudicateRequest } from "./adjudicateBrief";
import type { Prepared } from "./band";

/**
 * Shapes the adjudication request. The model gets bounds, an anchor and labels —
 * never the individual comparable prices behind them, which would let it
 * re-derive a range it has no authority over.
 */
export function adjudicateRequestFrom(
  company: string,
  buildStatus: BuildStatus,
  prepared: Prepared,
  intent: IntentRead | null,
  capex: CapexRead | null,
): AdjudicateRequest {
  const matched: MatchedComparable[] = prepared.set.candidates.map((c) => ({
    source: c.source,
    id: c.id,
    label: c.label,
    similarity: c.similarity,
    weight: c.weight,
  }));

  return {
    company,
    bounds: prepared.bounds,
    anchor: prepared.setupAnchor,
    matched,
    intent,
    capex,
    buildStatus,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing/recompute.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write the client adapter**

Create `src/lib/pricingClient.ts`:

```ts
import type { CapexRead, IntentRead } from "./types";
import type { Adjudication } from "./pricing/band";
import type { AdjudicateRequest } from "./pricing/adjudicateBrief";
import type { CapexQueryParams } from "./pricing/capexQuery";

async function post<T>(url: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error(
        `${label} needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.`,
      );
    }
    throw new Error(typeof err.error === "string" ? err.error : `${label} failed.`);
  }

  return (await res.json()) as T;
}

export async function getPricingStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/pricing/intent", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export function fetchIntent(leadId: string): Promise<IntentRead> {
  return post<IntentRead>("/api/pricing/intent", { leadId }, "The intent read");
}

export function fetchCapex(params: CapexQueryParams): Promise<CapexRead> {
  return post<CapexRead>("/api/pricing/capex", params, "The capex research");
}

export function fetchAdjudication(req: AdjudicateRequest): Promise<Adjudication> {
  return post<Adjudication>("/api/pricing/adjudicate", req, "The price adjudication");
}
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing/recompute.ts src/lib/pricing/recompute.test.ts src/lib/pricingClient.ts
git commit -m "feat(pricing): client adapter and adjudication request shaping"
```

---

## Task 14: Pricing settings

**Files:**
- Modify: `src/app/settings/page.tsx`
- Test: manual — this is a form over existing store plumbing.

**Interfaces:**
- Consumes: `Settings.targetMarginPct`, `Settings.minimumSetupFee`, `Settings.usdToZar`, `Settings.capexMultipliers` from Task 1.
- Produces: nothing new in code. Until this exists the engine runs on defaults with FX unset, so every USD comparable is silently dropped — which is why it lands before the pages.

The margin is entered as a whole-number percentage and stored as a fraction. Storing what the user typed would mean every consumer had to remember which one it was.

- [ ] **Step 1: Add the panel**

In `src/app/settings/page.tsx`, add a new `Panel` after the existing currency panel. It follows the file's established `draft` / `set(key, value)` pattern:

```tsx
<Panel title="Pricing">
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
    <Field
      label="Target margin on monthly (%)"
      hint="The retainer floor is running cost plus this. Nothing can be quoted below it."
    >
      <NumberInput
        value={Math.round((draft.targetMarginPct ?? 0) * 100)}
        min={0}
        max={500}
        onChange={(e) => set("targetMarginPct", Number(e.target.value) / 100)}
      />
    </Field>

    <Field
      label="Minimum setup fee"
      hint="Your absolute walk-away. Leave at 0 to let comparables set the floor alone."
    >
      <NumberInput
        value={draft.minimumSetupFee ?? 0}
        min={0}
        onChange={(e) => set("minimumSetupFee", Number(e.target.value))}
      />
    </Field>

    <Field
      label="USD → ZAR rate"
      hint="Market comparables are usually quoted in USD. Until this is set, they are excluded from matching."
    >
      <NumberInput
        value={draft.usdToZar ?? 0}
        min={0}
        step={0.01}
        onChange={(e) => set("usdToZar", Number(e.target.value))}
      />
    </Field>
  </div>

  <p className="eyebrow mt-6 mb-3">Capex ceiling multipliers</p>
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3.5">
    {(["micro", "small", "mid", "enterprise"] as const).map((band) => (
      <Field key={band} label={band}>
        <NumberInput
          value={draft.capexMultipliers?.[band] ?? 1}
          min={0}
          step={0.1}
          onChange={(e) =>
            set("capexMultipliers", {
              ...draft.capexMultipliers,
              [band]: Number(e.target.value),
            })
          }
        />
      </Field>
    ))}
  </div>
  <p className="text-[0.75rem] text-[var(--color-dim)] mt-3 leading-relaxed">
    Applied to the comparable-derived ceiling, not to the target. A bigger client
    does not make the work worth more — it widens how far above the anchor you can
    reasonably push.
  </p>
</Panel>
```

Ensure `NumberInput` is in the file's import from `@/components/ui/Field`.

- [ ] **Step 2: Verify it round-trips**

Run `npm run dev`, open `/settings`, set margin to 40, minimum setup fee to 50000, USD→ZAR to 18, and save. Reload the page.
Expected: all three values persist. Confirm at the database level:

```bash
curl -s localhost:3000/api/data | jq '.settings | {targetMarginPct, minimumSetupFee, usdToZar, capexMultipliers}'
```

Expected: `{"targetMarginPct": 0.4, "minimumSetupFee": 50000, "usdToZar": 18, "capexMultipliers": {...}}` — note the margin stored as `0.4`, not `40`.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(pricing): pricing settings — margin, floor, FX and capex multipliers"
```

---

## Task 15: Pricing section and quote list

**Files:**
- Modify: `src/components/layout/nav.ts`
- Create: `src/app/pricing/page.tsx`
- Test: manual.

**Interfaces:**
- Consumes: `useQuotes`, `useLeads`, `useSettings`, `useStore` from Task 1.
- Produces: the `/pricing` route and the `QuoteDetail` mount point that Tasks 16–18 fill in. Also `quoteStatusTone(status: QuoteStatus): Tone` in `src/lib/badges.ts`.

A quote always starts from a lead. There is no "blank quote" — without a lead there is nothing to score intent against, so the engine's most valuable half would be dead on arrival.

- [ ] **Step 1: Add the nav entry and the status tone**

In `src/components/layout/nav.ts`, add `Calculator` to the `lucide-react` import and this entry to `NAV`, directly after the `/targets` line so pricing sits with the rest of the pre-sale work:

```ts
  { href: "/pricing", label: "Pricing", icon: Calculator, group: "Pipeline" },
```

In `src/lib/badges.ts`, add `QuoteStatus` to the type import from `./types` and append:

```ts
export function quoteStatusTone(s: QuoteStatus): Tone {
  switch (s) {
    case "won":
      return "positive";
    case "lost":
      return "muted";
    case "sent":
      return "info";
    default:
      return "neutral";
  }
}
```

- [ ] **Step 2: Create the detail shell so the page compiles**

The list page imports `QuoteDetail`, which Task 16 fleshes out. Create the minimal working version now, or this task cannot be verified:

```tsx
// src/components/pricing/QuoteDetail.tsx
"use client";

import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLeads } from "@/lib/store";
import type { Quote } from "@/lib/types";

export function QuoteDetail({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const leads = useLeads();
  const lead = leads.find((l) => l.id === quote.leadId) ?? null;

  return (
    <PageHeader
      title={quote.name}
      subtitle={lead ? `${lead.company} · ${lead.contactName}` : "Lead missing"}
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          <ArrowLeft size={15} /> All quotes
        </button>
      }
    />
  );
}
```

Task 16 replaces this file wholesale.

- [ ] **Step 3: Write the list page**

Create `src/app/pricing/page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Calculator, Plus, Library } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput } from "@/components/ui/Field";
import { FilterSelect } from "@/components/ui/Detail";
import { QuoteDetail } from "@/components/pricing/QuoteDetail";
import { useLeads, useQuotes, useSettings, useStore } from "@/lib/store";
import { QUOTE_STATUSES, type Quote, type QuoteStatus } from "@/lib/types";
import { quoteStatusTone } from "@/lib/badges";
import { fmtCurrency, timeAgo } from "@/lib/utils";

const BLANK_ATTRS = {
  buildStatus: "new" as const,
  surfaces: 1,
  integrations: [] as string[],
  dataSources: 1,
  aiDepth: "none" as const,
  userCount: 1,
  supportLoad: "low" as const,
};

export default function PricingPage() {
  const quotes = useQuotes();
  const leads = useLeads();
  const settings = useSettings();
  const { create } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [newLeadId, setNewLeadId] = useState("");
  const [newName, setNewName] = useState("");

  const companyFor = useMemo(
    () => (q: Quote) => leads.find((l) => l.id === q.leadId)?.company ?? "—",
    [leads],
  );

  const visible = useMemo(
    () =>
      quotes.filter((q) => statusFilter === "all" || q.status === statusFilter),
    [quotes, statusFilter],
  );

  const selected = quotes.find((q) => q.id === selectedId) ?? null;

  function createQuote() {
    if (!newLeadId) return;
    const lead = leads.find((l) => l.id === newLeadId);
    const quote = create("quotes", {
      leadId: newLeadId,
      name: newName.trim() || `${lead?.company ?? "New"} build`,
      attributes: BLANK_ATTRS,
      opexLines: [],
      aiUsage: null,
      intent: null,
      capex: null,
      band: null,
      status: "draft",
      sentSetup: 0,
      sentMonthly: 0,
      closedSetup: 0,
      closedMonthly: 0,
      lostReason: "",
      notes: "",
    });
    setAdding(false);
    setNewLeadId("");
    setNewName("");
    setSelectedId(quote.id);
  }

  if (selected) {
    return <QuoteDetail quote={selected} onClose={() => setSelectedId(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Pricing"
        subtitle="What a deal is worth, argued from comparable solutions and what this client can actually spend."
        actions={
          <>
            <Link href="/pricing/comparables" className="btn btn-ghost">
              <Library size={15} /> Comparables
            </Link>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> New quote
            </button>
          </>
        }
      />

      <Panel
        title={`Quotes (${visible.length})`}
        action={
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All" },
              ...QUOTE_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
        }
        noPad
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title="No quotes yet"
            message="A quote starts from a lead — that is what the intent read scores against."
            action={
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} /> New quote
              </button>
            }
          />
        ) : (
          <table className="w-full text-[0.84rem]">
            <thead>
              <tr className="text-[var(--color-dim)] text-left">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Quote</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Setup</th>
                <th className="px-4 py-2 font-medium text-right">Monthly</th>
                <th className="px-4 py-2 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q) => (
                <tr
                  key={q.id}
                  className="border-t border-[var(--color-line)] hover:bg-[var(--color-surface-2)] cursor-pointer"
                  onClick={() => setSelectedId(q.id)}
                >
                  <td className="px-4 py-2.5">{companyFor(q)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">{q.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={quoteStatusTone(q.status)}>{q.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {q.band?.setup ? fmtCurrency(q.band.setup.target, settings.currency) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {q.band ? fmtCurrency(q.band.monthly.target, settings.currency) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-dim)]">
                    {timeAgo(q.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {adding && (
        <Modal title="New quote" onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-3.5">
            <Field
              label="Lead"
              hint="Required — the intent read scores this client's own words."
            >
              <select
                className="select"
                value={newLeadId}
                onChange={(e) => setNewLeadId(e.target.value)}
              >
                <option value="">Choose a lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.company} — {l.contactName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name" hint="Optional. Defaults to the company plus 'build'.">
              <TextInput
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Investor reporting build"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createQuote} disabled={!newLeadId}>
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verify**

Check `src/components/ui/Modal.tsx` for its actual prop names and adjust the `<Modal>` usage to match — the rest of the page does not depend on it.

Run `npm run dev`, open `/pricing`.
Expected: the section appears in the sidebar under Pipeline, the empty state renders, and creating a quote against a lead opens the detail view (which is still a stub until Task 16).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/nav.ts src/lib/badges.ts src/app/pricing/page.tsx
git commit -m "feat(pricing): pricing section with the quote list and new-quote flow"
```

---

## Task 16: Quote detail — lead, build and running cost

**Files:**
- Create: `src/components/pricing/QuoteDetail.tsx`
- Create: `src/components/pricing/BuildPanel.tsx`
- Create: `src/components/pricing/OpexPanel.tsx`
- Test: manual.

**Interfaces:**
- Consumes: `monthlyOpex` (Task 2), `PRICED_MODELS` (Task 2), `BUILD_STATUSES`/`AI_DEPTHS`/`SUPPORT_LOADS` (Task 1).
- Produces: `QuoteDetail`, referenced by Task 15; `BuildPanel`, `OpexPanel`. Task 17 adds `ReadsPanel` and Task 18 adds `PricePanel` to the same shell.

`QuoteDetail` owns the quote and writes straight through to the store on every change — the store already debounces persistence by 450ms, so a local draft buffer would only add a second source of truth.

- [ ] **Step 1: Write the detail shell**

Create `src/components/pricing/QuoteDetail.tsx`:

```tsx
"use client";

import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DetailGrid, DetailRow } from "@/components/ui/Detail";
import { Badge } from "@/components/ui/Badge";
import { BuildPanel } from "./BuildPanel";
import { OpexPanel } from "./OpexPanel";
import { useLeads, useSettings, useStore } from "@/lib/store";
import { qualityTone } from "@/lib/badges";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { Quote } from "@/lib/types";

export function QuoteDetail({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const leads = useLeads();
  const settings = useSettings();
  const { update } = useStore();

  const lead = leads.find((l) => l.id === quote.leadId) ?? null;

  // Straight through to the store — it already debounces persistence, so a local
  // draft buffer would only create a second source of truth to keep in sync.
  const patch = (p: Partial<Quote>) => update("quotes", quote.id, p);

  return (
    <>
      <PageHeader
        title={quote.name}
        subtitle={lead ? `${lead.company} · ${lead.contactName}` : "Lead missing"}
        actions={
          <button className="btn btn-ghost" onClick={onClose}>
            <ArrowLeft size={15} /> All quotes
          </button>
        }
      />

      <div className="flex flex-col gap-4">
        <Panel title="Lead">
          {lead ? (
            <DetailGrid>
              <DetailRow label="Company">{lead.company}</DetailRow>
              <DetailRow label="Quality">
                <Badge tone={qualityTone(lead.quality)}>{lead.quality}</Badge>
              </DetailRow>
              <DetailRow label="Estimated value">
                {lead.estimatedValue ? fmtCurrency(lead.estimatedValue, settings.currency) : ""}
              </DetailRow>
              <DetailRow label="Last contact">
                {lead.lastContact ? fmtDate(lead.lastContact) : ""}
              </DetailRow>
              <DetailRow label="Pain point" full>
                {lead.painPoint}
              </DetailRow>
            </DetailGrid>
          ) : (
            <p className="text-[0.84rem] text-[var(--color-muted)]">
              This quote points at a lead that no longer exists. Intent cannot be scored.
            </p>
          )}
        </Panel>

        <BuildPanel quote={quote} onPatch={patch} />
        <OpexPanel quote={quote} onPatch={patch} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write the build panel**

Create `src/components/pricing/BuildPanel.tsx`:

```tsx
"use client";

import { Panel } from "@/components/ui/Panel";
import { Field, FormGrid, NumberInput, Select, TextInput } from "@/components/ui/Field";
import {
  AI_DEPTHS, BUILD_STATUSES, SUPPORT_LOADS,
  type AiDepth, type BuildStatus, type Quote, type SupportLoad,
} from "@/lib/types";

export function BuildPanel({
  quote,
  onPatch,
}: {
  quote: Quote;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const a = quote.attributes;
  const setAttr = (p: Partial<Quote["attributes"]>) =>
    onPatch({ attributes: { ...a, ...p } });

  return (
    <Panel title="Build">
      <FormGrid>
        <Field
          label="Build status"
          hint="Licensing something already built does not lower the price — it lowers the floor, so the whole range becomes margin."
        >
          <Select
            options={BUILD_STATUSES}
            value={a.buildStatus}
            onChange={(e) => setAttr({ buildStatus: e.target.value as BuildStatus })}
          />
        </Field>
        <Field label="Surfaces" hint="Screens or sections.">
          <NumberInput
            value={a.surfaces}
            min={0}
            onChange={(e) => setAttr({ surfaces: Number(e.target.value) })}
          />
        </Field>
        <Field label="Integrations" hint="Comma separated, e.g. Gmail, Xero.">
          <TextInput
            value={a.integrations.join(", ")}
            onChange={(e) =>
              setAttr({
                integrations: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="Data sources">
          <NumberInput
            value={a.dataSources}
            min={0}
            onChange={(e) => setAttr({ dataSources: Number(e.target.value) })}
          />
        </Field>
        <Field label="AI depth">
          <Select
            options={AI_DEPTHS}
            value={a.aiDepth}
            onChange={(e) => setAttr({ aiDepth: e.target.value as AiDepth })}
          />
        </Field>
        <Field label="Users">
          <NumberInput
            value={a.userCount}
            min={0}
            onChange={(e) => setAttr({ userCount: Number(e.target.value) })}
          />
        </Field>
        <Field label="Support load">
          <Select
            options={SUPPORT_LOADS}
            value={a.supportLoad}
            onChange={(e) => setAttr({ supportLoad: e.target.value as SupportLoad })}
          />
        </Field>
      </FormGrid>
    </Panel>
  );
}
```

- [ ] **Step 3: Write the running-cost panel**

Create `src/components/pricing/OpexPanel.tsx`:

```tsx
"use client";

import { Plus, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Field, FormGrid, NumberInput, Select, TextInput } from "@/components/ui/Field";
import { monthlyOpex } from "@/lib/pricing/opex";
import { PRICED_MODELS } from "@/lib/pricing/prices";
import { useSettings } from "@/lib/store";
import { fmtCurrency, uid } from "@/lib/utils";
import type { OpexLine, Quote } from "@/lib/types";

export function OpexPanel({
  quote,
  onPatch,
}: {
  quote: Quote;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const settings = useSettings();
  const opex = monthlyOpex(quote.opexLines, quote.aiUsage, settings.usdToZar);
  const floor = Math.round(opex.total * (1 + settings.targetMarginPct));

  const setLine = (id: string, p: Partial<OpexLine>) =>
    onPatch({ opexLines: quote.opexLines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  const ai = quote.aiUsage;

  return (
    <Panel
      title="Running cost"
      action={
        <button
          className="btn btn-ghost"
          onClick={() =>
            onPatch({
              opexLines: [...quote.opexLines, { id: uid("opex"), label: "", monthlyCost: 0 }],
            })
          }
        >
          <Plus size={14} /> Line
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {quote.opexLines.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <TextInput
              value={l.label}
              placeholder="Hosting"
              onChange={(e) => setLine(l.id, { label: e.target.value })}
            />
            <NumberInput
              value={l.monthlyCost}
              min={0}
              onChange={(e) => setLine(l.id, { monthlyCost: Number(e.target.value) })}
            />
            <button
              className="btn btn-ghost btn-icon"
              aria-label="Remove line"
              onClick={() =>
                onPatch({ opexLines: quote.opexLines.filter((x) => x.id !== l.id) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <p className="eyebrow mt-6 mb-3">AI usage</p>
      {ai ? (
        <>
          <FormGrid>
            <Field label="Model">
              <Select
                options={PRICED_MODELS}
                value={ai.model}
                onChange={(e) => onPatch({ aiUsage: { ...ai, model: e.target.value } })}
              />
            </Field>
            <Field label="Runs per day">
              <NumberInput
                value={ai.runsPerDay}
                min={0}
                onChange={(e) => onPatch({ aiUsage: { ...ai, runsPerDay: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Input tokens per run">
              <NumberInput
                value={ai.inputTokensPerRun}
                min={0}
                onChange={(e) =>
                  onPatch({ aiUsage: { ...ai, inputTokensPerRun: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="Output tokens per run">
              <NumberInput
                value={ai.outputTokensPerRun}
                min={0}
                onChange={(e) =>
                  onPatch({ aiUsage: { ...ai, outputTokensPerRun: Number(e.target.value) } })
                }
              />
            </Field>
          </FormGrid>
          <button
            className="btn btn-ghost mt-3"
            onClick={() => onPatch({ aiUsage: null })}
          >
            Remove AI line
          </button>
        </>
      ) : (
        <button
          className="btn btn-ghost"
          onClick={() =>
            onPatch({
              aiUsage: {
                model: "claude-sonnet-5",
                runsPerDay: 10,
                inputTokensPerRun: 2000,
                outputTokensPerRun: 500,
                inputPriceOverride: null,
                outputPriceOverride: null,
              },
            })
          }
        >
          <Plus size={14} /> Add AI usage line
        </button>
      )}

      {opex.unpricedModel && (
        <p className="text-[0.78rem] text-[var(--color-accent)] mt-4 leading-relaxed">
          The AI line is not costed — {opex.unpricedModel} has no price, or the USD→ZAR rate
          is unset in Settings. The retainer floor below excludes it.
        </p>
      )}

      <div className="flex items-baseline justify-between mt-6 pt-4 border-t border-[var(--color-line)]">
        <span className="text-[0.8rem] text-[var(--color-muted)]">
          Monthly cash out · {fmtCurrency(Math.round(opex.total), settings.currency)}
        </span>
        <span className="text-[0.95rem] tnum text-[var(--color-ink)]">
          Retainer floor {fmtCurrency(floor, settings.currency)}
        </span>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Verify**

Run `npm run dev`, open a quote from `/pricing`.
Expected: the three panels render; editing an attribute or an opex line persists across a reload; adding an AI line at 100 runs/day with the FX rate set moves the retainer floor.

Set the USD→ZAR rate to 0 in Settings and reload the quote.
Expected: the amber warning about an uncosted AI line appears, and the floor drops to fixed lines plus margin only.

- [ ] **Step 5: Commit**

```bash
git add src/components/pricing/QuoteDetail.tsx src/components/pricing/BuildPanel.tsx src/components/pricing/OpexPanel.tsx
git commit -m "feat(pricing): quote detail with build attributes and running cost"
```

---

## Task 17: Quote detail — the two reads

**Files:**
- Create: `src/components/pricing/ReadsPanel.tsx`
- Modify: `src/components/pricing/QuoteDetail.tsx`
- Test: manual.

**Interfaces:**
- Consumes: `fetchIntent`, `fetchCapex` from Task 13; `IntentRead`, `CapexRead` from Task 1.
- Produces: `ReadsPanel`, mounted by `QuoteDetail`.

Both reads are **cached onto the quote** and refreshed only on an explicit click. Re-running on render would re-bill a web search every time the panel mounts, and — more to the point — an outbound lookup naming a real prospect should be something the founder chose to do.

- [ ] **Step 1: Write the panel**

Create `src/components/pricing/ReadsPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { fetchCapex, fetchIntent } from "@/lib/pricingClient";
import { timeAgo } from "@/lib/utils";
import type { Lead, Quote } from "@/lib/types";

function Card({
  title,
  headline,
  timestamp,
  busy,
  error,
  onRefresh,
  children,
}: {
  title: string;
  headline: React.ReactNode;
  timestamp: string | null;
  busy: boolean;
  error: string;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[var(--color-line)] rounded-[10px] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <button
          className="flex items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[0.8rem] text-[var(--color-muted)]">{title}</span>
          <span className="text-[0.9rem] text-[var(--color-ink)]">{headline}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.72rem] text-[var(--color-dim)]">
            {timestamp ? timeAgo(timestamp) : "never run"}
          </span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onRefresh}
            disabled={busy}
            aria-label={`Refresh ${title}`}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[0.78rem] text-[var(--color-accent)] mt-2">{error}</p>
      )}
      {open && <div className="mt-3.5">{children}</div>}
    </div>
  );
}

export function ReadsPanel({
  quote,
  lead,
  onPatch,
}: {
  quote: Quote;
  lead: Lead | null;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const [intentBusy, setIntentBusy] = useState(false);
  const [capexBusy, setCapexBusy] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [capexError, setCapexError] = useState("");

  async function runIntent() {
    if (!lead) return;
    setIntentBusy(true);
    setIntentError("");
    try {
      onPatch({ intent: await fetchIntent(lead.id) });
    } catch (e) {
      setIntentError(e instanceof Error ? e.message : "The intent read failed.");
    } finally {
      setIntentBusy(false);
    }
  }

  async function runCapex() {
    if (!lead) return;
    setCapexBusy(true);
    setCapexError("");
    try {
      onPatch({
        capex: await fetchCapex({
          company: lead.company,
          industry: lead.industry,
          companyType: lead.companyType,
        }),
      });
    } catch (e) {
      setCapexError(e instanceof Error ? e.message : "The capex research failed.");
    } finally {
      setCapexBusy(false);
    }
  }

  const intent = quote.intent;
  const capex = quote.capex;

  return (
    <Panel title="Reads">
      <div className="flex flex-col gap-3">
        <Card
          title="Buying intent"
          headline={
            intent ? (
              <>
                <span className="tnum">{intent.score}</span>/100{" "}
                <Badge tone={intent.band === "hot" ? "positive" : intent.band === "warm" ? "warning" : "muted"}>
                  {intent.band}
                </Badge>
              </>
            ) : (
              <span className="text-[var(--color-dim)]">not read</span>
            )
          }
          timestamp={intent?.generatedAt ?? null}
          busy={intentBusy}
          error={intentError}
          onRefresh={runIntent}
        >
          {intent && (
            <div className="flex flex-col gap-3 text-[0.83rem]">
              <div>
                <p className="eyebrow mb-1.5">Signals</p>
                {intent.signals.length === 0 ? (
                  <p className="text-[var(--color-dim)]">
                    Nothing in the record supported a score.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {intent.signals.map((s, i) => (
                      <li key={i} className="text-[var(--color-ink-soft)] leading-relaxed">
                        &ldquo;{s.quote}&rdquo;
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {intent.risks.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">Risks</p>
                  <ul className="flex flex-col gap-1">
                    {intent.risks.map((r, i) => (
                      <li key={i} className="text-[var(--color-muted)]">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Capex"
          headline={
            capex ? (
              <>
                <Badge tone={capex.band === "unknown" ? "muted" : "info"}>{capex.band}</Badge>{" "}
                <span className="text-[0.78rem] text-[var(--color-dim)]">
                  {capex.confidence} confidence
                </span>
              </>
            ) : (
              <span className="text-[var(--color-dim)]">not researched</span>
            )
          }
          timestamp={capex?.generatedAt ?? null}
          busy={capexBusy}
          error={capexError}
          onRefresh={runCapex}
        >
          {capex && (
            <div className="flex flex-col gap-3 text-[0.83rem]">
              {(capex.headcount || capex.revenueNote) && (
                <p className="text-[var(--color-ink-soft)]">
                  {capex.headcount ? `~${capex.headcount} staff. ` : ""}
                  {capex.revenueNote}
                </p>
              )}
              <div>
                <p className="eyebrow mb-1.5">Sources</p>
                {capex.evidence.length === 0 ? (
                  <p className="text-[var(--color-dim)]">Nothing citable was found.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {capex.evidence.map((e, i) => (
                      <li key={i}>
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-ink-soft)] underline decoration-[var(--color-line-strong)] hover:decoration-[var(--color-ink)]"
                        >
                          {e.claim || e.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {!lead && (
        <p className="text-[0.78rem] text-[var(--color-dim)] mt-3">
          Both reads need a lead. This quote has none.
        </p>
      )}
    </Panel>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/components/pricing/QuoteDetail.tsx`, import `ReadsPanel` and add it after `<OpexPanel …/>`:

```tsx
        <OpexPanel quote={quote} onPatch={patch} />
        <ReadsPanel quote={quote} lead={lead} onPatch={patch} />
```

- [ ] **Step 3: Verify**

With `npm run dev` and a key set, open a quote whose lead has interactions logged and click Refresh on Buying intent.
Expected: a score appears within a few seconds, and expanding the card shows signals quoting text that genuinely appears in the lead or its interactions. If a "signal" is a paraphrase rather than a quote, the route's system prompt is not landing — tighten it before moving on.

Click Refresh on Capex for a lead whose company is real and public.
Expected: a band with at least one clickable source. Reload the page — both cards still show their values and timestamps, and nothing re-runs.

- [ ] **Step 4: Commit**

```bash
git add src/components/pricing/ReadsPanel.tsx src/components/pricing/QuoteDetail.tsx
git commit -m "feat(pricing): cached intent and capex reads with cited evidence"
```

---

## Task 18: Quote detail — the price band and closing the loop

**Files:**
- Create: `src/components/pricing/PricePanel.tsx`
- Modify: `src/components/pricing/QuoteDetail.tsx`
- Test: manual.

**Interfaces:**
- Consumes: `preparePricing`, `buildBand` (Task 8), `adjudicateRequestFrom` (Task 13), `fetchAdjudication` (Task 13).
- Produces: `PricePanel`. This is the last piece of the quote surface.

Two things this panel must get right. **A failed adjudication still produces a band** — `buildBand` is called with `null` rather than the recompute being abandoned. And **marking a quote won or lost is what feeds the comparables library**, so those buttons are not an afterthought; they are the input mechanism for every future price.

- [ ] **Step 1: Write the panel**

Create `src/components/pricing/PricePanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Field, NumberInput, Select } from "@/components/ui/Field";
import { preparePricing, buildBand } from "@/lib/pricing/band";
import { adjudicateRequestFrom } from "@/lib/pricing/recompute";
import { fetchAdjudication } from "@/lib/pricingClient";
import { useComparables, useQuotes, useSettings } from "@/lib/store";
import { fmtCurrency, nowISO } from "@/lib/utils";
import { LOST_REASONS, type Lead, type LostReason, type PriceTriple, type Quote } from "@/lib/types";

const DEGRADE_COPY: Record<string, string> = {
  "no-anchor": "Too few comparable solutions to anchor a setup fee — add some in the library.",
  "no-intent": "No buying-intent read, so the target is not adjusted for how badly they want it.",
  "no-capex": "No capex read, so the ceiling is not adjusted for what they can afford.",
  "no-adjudication": "Priced without an adjudication — the target sits at the comparable midpoint.",
  "no-fx-rate": "USD comparables were excluded: set the USD→ZAR rate in Settings.",
  "unpriced-ai-model": "The AI usage line is uncosted, so the retainer floor may be too low.",
};

function TripleRow({ label, triple, currency }: { label: string; triple: PriceTriple | null; currency: "ZAR" | "USD" }) {
  if (!triple) {
    return (
      <tr className="border-t border-[var(--color-line)]">
        <td className="py-3 text-[var(--color-muted)]">{label}</td>
        <td colSpan={3} className="py-3 text-[var(--color-dim)] text-[0.83rem]">
          No range — not enough comparables.
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-[var(--color-line)]">
      <td className="py-3 text-[var(--color-muted)]">{label}</td>
      <td className="py-3 text-right tnum">{fmtCurrency(triple.floor, currency)}</td>
      <td className="py-3 text-right tnum text-[var(--color-accent)] text-[1.05rem]">
        {fmtCurrency(triple.target, currency)}
      </td>
      <td className="py-3 text-right tnum">{fmtCurrency(triple.stretch, currency)}</td>
    </tr>
  );
}

export function PricePanel({
  quote,
  lead,
  onPatch,
}: {
  quote: Quote;
  lead: Lead | null;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const settings = useSettings();
  const comparables = useComparables();
  const quotes = useQuotes();
  const [busy, setBusy] = useState(false);

  async function recompute() {
    setBusy(true);
    const prepared = preparePricing({
      attributes: quote.attributes,
      opexLines: quote.opexLines,
      aiUsage: quote.aiUsage,
      comparables,
      quotes,
      currentQuoteId: quote.id,
      settings,
      intent: quote.intent,
      capex: quote.capex,
    });

    // A failed adjudication degrades to the deterministic band. Abandoning the
    // recompute would leave the founder with no number at all, which is worse.
    let adjudication = null;
    try {
      adjudication = await fetchAdjudication(
        adjudicateRequestFrom(
          lead?.company ?? "Unknown",
          quote.attributes.buildStatus,
          prepared,
          quote.intent,
          quote.capex,
        ),
      );
    } catch {
      adjudication = null;
    }

    onPatch({ band: buildBand(prepared, adjudication, settings.currency, nowISO()) });
    setBusy(false);
  }

  const band = quote.band;

  return (
    <Panel
      title="Price"
      action={
        <button className="btn btn-primary" onClick={recompute} disabled={busy}>
          <Calculator size={14} /> {busy ? "Pricing…" : "Recompute"}
        </button>
      }
    >
      {!band ? (
        <p className="text-[0.84rem] text-[var(--color-muted)]">
          Nothing priced yet. Fill in the build and running cost, then recompute.
        </p>
      ) : (
        <>
          <table className="w-full text-[0.86rem]">
            <thead>
              <tr className="text-[var(--color-dim)] text-[0.7rem] uppercase tracking-wider">
                <th className="text-left font-medium pb-1"></th>
                <th className="text-right font-medium pb-1">Floor</th>
                <th className="text-right font-medium pb-1">Target</th>
                <th className="text-right font-medium pb-1">Stretch</th>
              </tr>
            </thead>
            <tbody>
              <TripleRow label="Setup" triple={band.setup} currency={settings.currency} />
              <TripleRow label="Monthly" triple={band.monthly} currency={settings.currency} />
            </tbody>
          </table>

          {quote.attributes.buildStatus === "license as-is" && band.setup && (
            <p className="text-[0.8rem] text-[var(--color-muted)] mt-4 leading-relaxed">
              Already built, so the setup fee recovers no build cost —{" "}
              {fmtCurrency(band.setup.target, settings.currency)} is effectively all margin.
            </p>
          )}

          {band.clamps.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {band.clamps.map((c, i) => (
                <li key={i} className="text-[0.79rem] text-[var(--color-muted)] leading-relaxed">
                  {c}
                </li>
              ))}
            </ul>
          )}

          {band.reasoning && (
            <p className="text-[0.84rem] text-[var(--color-ink-soft)] mt-4 leading-relaxed">
              {band.reasoning}
            </p>
          )}

          {band.degraded.length > 0 && (
            <ul className="mt-4 pt-3 border-t border-[var(--color-line)] flex flex-col gap-1.5">
              {band.degraded.map((d) => (
                <li key={d} className="text-[0.78rem] text-[var(--color-dim)]">
                  {DEGRADE_COPY[d] ?? d}
                </li>
              ))}
            </ul>
          )}

          {band.matched.length > 0 && (
            <p className="text-[0.75rem] text-[var(--color-dim)] mt-4">
              Anchored on {band.matched.length} comparable
              {band.matched.length === 1 ? "" : "s"}:{" "}
              {band.matched.map((m) => m.label).join(", ")}.
            </p>
          )}
        </>
      )}

      <div className="mt-6 pt-4 border-t border-[var(--color-line)]">
        <p className="eyebrow mb-3">Outcome</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="Quoted setup">
            <NumberInput
              value={quote.sentSetup}
              min={0}
              onChange={(e) => onPatch({ sentSetup: Number(e.target.value) })}
            />
          </Field>
          <Field label="Quoted monthly">
            <NumberInput
              value={quote.sentMonthly}
              min={0}
              onChange={(e) => onPatch({ sentMonthly: Number(e.target.value) })}
            />
          </Field>
          {quote.status === "won" && (
            <>
              <Field label="Closed setup">
                <NumberInput
                  value={quote.closedSetup}
                  min={0}
                  onChange={(e) => onPatch({ closedSetup: Number(e.target.value) })}
                />
              </Field>
              <Field label="Closed monthly">
                <NumberInput
                  value={quote.closedMonthly}
                  min={0}
                  onChange={(e) => onPatch({ closedMonthly: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
          {quote.status === "lost" && (
            <Field
              label="Why it was lost"
              hint="Only a price loss caps future stretch. A timing loss must not drag your pricing down."
            >
              <Select
                options={LOST_REASONS}
                value={quote.lostReason || "other"}
                onChange={(e) => onPatch({ lostReason: e.target.value as LostReason })}
              />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            className="btn btn-ghost"
            onClick={() =>
              onPatch({
                status: "sent",
                sentSetup: quote.sentSetup || band?.setup?.target || 0,
                sentMonthly: quote.sentMonthly || band?.monthly.target || 0,
              })
            }
          >
            Mark sent
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              onPatch({
                status: "won",
                closedSetup: quote.closedSetup || quote.sentSetup,
                closedMonthly: quote.closedMonthly || quote.sentMonthly,
              })
            }
          >
            Won
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => onPatch({ status: "lost", lostReason: quote.lostReason || "other" })}
          >
            Lost
          </button>
        </div>
        <p className="text-[0.75rem] text-[var(--color-dim)] mt-3 leading-relaxed">
          Closing a quote is what feeds the comparables library — every future price is
          anchored on the ones you finish.
        </p>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/components/pricing/QuoteDetail.tsx`, import `PricePanel` and add it after `<ReadsPanel …/>`:

```tsx
        <ReadsPanel quote={quote} lead={lead} onPatch={patch} />
        <PricePanel quote={quote} lead={lead} onPatch={patch} />
```

- [ ] **Step 3: Verify the degraded path first**

With **no comparables in the library**, open a quote with an opex line and click Recompute.
Expected: a monthly band appears with floor = opex × (1 + margin), the setup row reads "No range — not enough comparables", and the degraded list explains both. Critically, a number still appeared.

- [ ] **Step 4: Verify the clamp is visible**

Temporarily stop the dev server's network access to the API (or unset `ANTHROPIC_API_KEY` and restart) and recompute.
Expected: the band still renders, with "Priced without an adjudication" in the degraded list. Restore the key afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/components/pricing/PricePanel.tsx src/components/pricing/QuoteDetail.tsx
git commit -m "feat(pricing): price band panel with clamps and outcome capture"
```

---

## Task 19: The comparables library

**Files:**
- Create: `src/app/pricing/comparables/page.tsx`
- Test: manual.

**Interfaces:**
- Consumes: `useComparables`, `useQuotes`, `useSettings`, `useStore` (Task 1); `COMPARABLE_KINDS`, `BUILD_STATUSES`, `AI_DEPTHS`, `SUPPORT_LOADS` (Task 1).
- Produces: the `/pricing/comparables` route. Nothing else depends on it.

Two sections, and the difference between them is the point. Market examples and reference builds are **authored** — you add, edit and delete them. Own deals are **derived** from closed quotes and are read-only here; editing history to make a price look better would corrupt the only honest evidence in the system.

- [ ] **Step 1: Write the page**

Create `src/app/pricing/comparables/page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Library, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import {
  Field, FormGrid, NumberInput, Select, TextArea, TextInput,
} from "@/components/ui/Field";
import { useComparables, useLeads, useQuotes, useSettings, useStore } from "@/lib/store";
import {
  AI_DEPTHS, BUILD_STATUSES, COMPARABLE_KINDS, SUPPORT_LOADS,
  type AiDepth, type BuildStatus, type Comparable, type ComparableKind, type SupportLoad,
} from "@/lib/types";
import { fmtCurrency } from "@/lib/utils";

const BLANK = {
  kind: "market" as ComparableKind,
  name: "",
  notes: "",
  sourceUrl: "",
  attributes: {
    buildStatus: "new" as BuildStatus,
    surfaces: 1,
    integrations: [] as string[],
    dataSources: 1,
    aiDepth: "none" as AiDepth,
    userCount: 1,
    supportLoad: "low" as SupportLoad,
  },
  setupPrice: 0,
  monthlyPrice: 0,
  currency: "ZAR" as const,
};

export default function ComparablesPage() {
  const comparables = useComparables();
  const quotes = useQuotes();
  const leads = useLeads();
  const settings = useSettings();
  const { create, update, remove } = useStore();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);

  const ownDeals = useMemo(
    () =>
      quotes
        .filter((q) => q.status === "won" || q.status === "lost")
        .map((q) => ({
          id: q.id,
          name: q.name,
          company: leads.find((l) => l.id === q.leadId)?.company ?? "—",
          status: q.status,
          lostReason: q.lostReason,
          setup: q.status === "won" ? q.closedSetup : q.sentSetup,
          monthly: q.status === "won" ? q.closedMonthly : q.sentMonthly,
        })),
    [quotes, leads],
  );

  function save() {
    if (!draft.name.trim()) return;
    create("comparables", draft);
    setDraft(BLANK);
    setAdding(false);
  }

  return (
    <>
      <PageHeader
        title="Comparables"
        subtitle="What similar solutions cost. This is the evidence every setup fee is argued from."
        actions={
          <>
            <Link href="/pricing" className="btn btn-ghost">
              <ArrowLeft size={15} /> Quotes
            </Link>
            <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
              <Plus size={15} /> Add comparable
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {adding && (
          <Panel title="New comparable">
            <FormGrid>
              <Field label="Kind" hint="Market: what a vendor charges. Reference: an anchor you authored.">
                <Select
                  options={COMPARABLE_KINDS}
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as ComparableKind })}
                />
              </Field>
              <Field label="Name">
                <TextInput
                  value={draft.name}
                  placeholder="Vendor X reporting suite"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Setup price">
                <NumberInput
                  value={draft.setupPrice}
                  min={0}
                  onChange={(e) => setDraft({ ...draft, setupPrice: Number(e.target.value) })}
                />
              </Field>
              <Field label="Monthly price">
                <NumberInput
                  value={draft.monthlyPrice}
                  min={0}
                  onChange={(e) => setDraft({ ...draft, monthlyPrice: Number(e.target.value) })}
                />
              </Field>
              <Field label="Currency" hint="USD entries need the FX rate set in Settings, or they are excluded.">
                <Select
                  options={["ZAR", "USD"] as const}
                  value={draft.currency}
                  onChange={(e) =>
                    setDraft({ ...draft, currency: e.target.value as "ZAR" | "USD" })
                  }
                />
              </Field>
              <Field label="Source URL">
                <TextInput
                  value={draft.sourceUrl}
                  onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                />
              </Field>
              <Field label="Surfaces">
                <NumberInput
                  value={draft.attributes.surfaces}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, surfaces: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Data sources">
                <NumberInput
                  value={draft.attributes.dataSources}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, dataSources: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Integrations" hint="Comma separated.">
                <TextInput
                  value={draft.attributes.integrations.join(", ")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: {
                        ...draft.attributes,
                        integrations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="AI depth">
                <Select
                  options={AI_DEPTHS}
                  value={draft.attributes.aiDepth}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, aiDepth: e.target.value as AiDepth },
                    })
                  }
                />
              </Field>
              <Field label="Users">
                <NumberInput
                  value={draft.attributes.userCount}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, userCount: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Support load">
                <Select
                  options={SUPPORT_LOADS}
                  value={draft.attributes.supportLoad}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, supportLoad: e.target.value as SupportLoad },
                    })
                  }
                />
              </Field>
              <Field label="Build status">
                <Select
                  options={BUILD_STATUSES}
                  value={draft.attributes.buildStatus}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, buildStatus: e.target.value as BuildStatus },
                    })
                  }
                />
              </Field>
            </FormGrid>
            <Field label="Notes" className="mt-3.5">
              <TextArea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Where you saw this, and anything that qualifies the number."
              />
            </Field>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
                Save
              </button>
            </div>
          </Panel>
        )}

        <Panel title={`Market examples and reference builds (${comparables.length})`} noPad>
          {comparables.length === 0 ? (
            <EmptyState
              icon={Library}
              title="No comparables yet"
              message="Three similar examples is the minimum before a setup fee can be anchored at all."
            />
          ) : (
            <table className="w-full text-[0.84rem]">
              <thead>
                <tr className="text-[var(--color-dim)] text-left">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium text-right">Setup</th>
                  <th className="px-4 py-2 font-medium text-right">Monthly</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {comparables.map((c: Comparable) => (
                  <tr key={c.id} className="border-t border-[var(--color-line)]">
                    <td className="px-4 py-2.5">
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-[var(--color-line-strong)]">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={c.kind === "market" ? "info" : "neutral"}>{c.kind}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tnum">
                      {fmtCurrency(c.setupPrice, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tnum">
                      {fmtCurrency(c.monthlyPrice, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="btn btn-ghost btn-icon"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => remove("comparables", c.id)}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={`Your own closed deals (${ownDeals.length})`} noPad>
          {ownDeals.length === 0 ? (
            <EmptyState
              icon={Library}
              title="No closed deals yet"
              message="Mark a quote won or lost and it appears here automatically — the strongest evidence you have."
            />
          ) : (
            <>
              <table className="w-full text-[0.84rem]">
                <thead>
                  <tr className="text-[var(--color-dim)] text-left">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Quote</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 font-medium text-right">Setup</th>
                    <th className="px-4 py-2 font-medium text-right">Monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {ownDeals.map((d) => (
                    <tr key={d.id} className="border-t border-[var(--color-line)]">
                      <td className="px-4 py-2.5">{d.company}</td>
                      <td className="px-4 py-2.5 text-[var(--color-muted)]">{d.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={d.status === "won" ? "positive" : "muted"}>
                          {d.status === "lost" && d.lostReason ? `lost · ${d.lostReason}` : d.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {fmtCurrency(d.setup, settings.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {fmtCurrency(d.monthly, settings.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-[0.75rem] text-[var(--color-dim)] leading-relaxed border-t border-[var(--color-line)]">
                Read-only — these are derived from your quotes. Wins anchor the range; only a
                loss recorded as a price loss caps the stretch.
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run `npm run dev`, open `/pricing/comparables`. Add three market examples with similar attributes and prices around R90k / R120k / R160k.
Expected: they list, and the own-deals section shows any quote already marked won or lost.

Return to a quote whose build attributes resemble those comparables and recompute.
Expected: a setup band now appears, the `no-anchor` degrade note is gone, and the footer names the comparables it anchored on.

- [ ] **Step 3: Commit**

```bash
git add src/app/pricing/comparables/page.tsx
git commit -m "feat(pricing): comparables library with derived closed-deal evidence"
```

---

## Task 20: End-to-end verification

**Files:**
- Create: `src/lib/pricing/endToEnd.test.ts`
- Test: this task is the test.

**Interfaces:**
- Consumes: the whole engine.
- Produces: nothing new. This pins the behaviours the spec promises, in the manner of `e26622e` for the daily engine.

Unit tests prove each part. This proves the promises: that a price is always produced, that the floor holds under every input, and that the two rules the founder actually cares about — licensing widens margin, price-losses cap the stretch — survive assembly.

- [ ] **Step 1: Write the test**

Create `src/lib/pricing/endToEnd.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preparePricing, buildBand } from "./band";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { BuildAttributes, Comparable, Quote, Settings } from "@/lib/types";

const NOW = "2026-08-10T09:00:00.000Z";

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  usdToZar: 18,
  minimumSetupFee: 40000,
  targetMarginPct: 0.4,
};

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const COMPARABLES: Comparable[] = [90000, 120000, 160000].map((setupPrice, i) => ({
  id: `c${i}`, createdAt: "", updatedAt: "", kind: "market",
  name: `Vendor ${i}`, notes: "", sourceUrl: "",
  attributes: ATTRS, setupPrice, monthlyPrice: setupPrice / 14, currency: "ZAR",
}));

const OPEX = [{ id: "h", label: "Hosting", monthlyCost: 4000 }];

function run(over: Partial<Parameters<typeof preparePricing>[0]> = {}) {
  const prepared = preparePricing({
    attributes: ATTRS,
    opexLines: OPEX,
    aiUsage: null,
    comparables: COMPARABLES,
    quotes: [],
    currentQuoteId: "current",
    settings: SETTINGS,
    intent: null,
    capex: null,
    ...over,
  });
  return { prepared, band: buildBand(prepared, null, "ZAR", NOW) };
}

describe("pricing engine end to end", () => {
  it("always produces a monthly price, however little it knows", () => {
    const { band } = run({ comparables: [], opexLines: [], aiUsage: null });
    expect(band.monthly.target).toBeGreaterThanOrEqual(band.monthly.floor);
    expect(band.setup).toBeNull();
    expect(band.degraded).toContain("no-anchor");
  });

  it("never quotes a monthly below running cost plus margin", () => {
    const { band } = run();
    expect(band.monthly.floor).toBe(5600); // 4000 × 1.4
    expect(band.monthly.target).toBeGreaterThanOrEqual(5600);
    expect(band.monthly.stretch).toBeGreaterThanOrEqual(band.monthly.target);
  });

  it("orders every band floor ≤ target ≤ stretch", () => {
    const { band } = run();
    expect(band.setup!.floor).toBeLessThanOrEqual(band.setup!.target);
    expect(band.setup!.target).toBeLessThanOrEqual(band.setup!.stretch);
  });

  it("prices a licensed build exactly as high as a new one", () => {
    const newBuild = run().band;
    const licensed = run({ attributes: { ...ATTRS, buildStatus: "license as-is" } }).band;
    expect(licensed.setup!.target).toBe(newBuild.setup!.target);
    expect(licensed.setup!.stretch).toBe(newBuild.setup!.stretch);
  });

  it("lets capex widen the ceiling without moving the floor", () => {
    const small = run().band;
    const big = run({
      capex: {
        band: "enterprise", headcount: 900, revenueNote: "",
        evidence: [{ claim: "900 staff", url: "https://x.com" }],
        confidence: "high", generatedAt: NOW,
      },
    }).band;
    expect(big.setup!.stretch).toBeGreaterThan(small.setup!.stretch);
    expect(big.setup!.floor).toBe(small.setup!.floor);
  });

  it("caps the stretch after a price loss, and names the deal that caused it", () => {
    const lost: Quote = {
      id: "lost1", createdAt: "", updatedAt: "", leadId: "l1", name: "Kestrelmoor",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 100000, sentMonthly: 8000,
      closedSetup: 0, closedMonthly: 0, lostReason: "price", notes: "",
    };
    const capped = run({ quotes: [lost] }).band;
    const uncapped = run().band;
    expect(capped.setup!.stretch).toBeLessThan(uncapped.setup!.stretch);
    expect(capped.clamps.join(" ")).toContain("Kestrelmoor");
  });

  it("ignores a loss that was not about price", () => {
    const lost: Quote = {
      id: "lost2", createdAt: "", updatedAt: "", leadId: "l1", name: "Timing",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 100000, sentMonthly: 8000,
      closedSetup: 0, closedMonthly: 0, lostReason: "timing", notes: "",
    };
    expect(run({ quotes: [lost] }).band.setup!.stretch).toBe(run().band.setup!.stretch);
  });

  it("promotes a won deal into the evidence the next quote is priced from", () => {
    const won: Quote = {
      id: "won1", createdAt: "", updatedAt: "", leadId: "l1", name: "Acme",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "won", sentSetup: 200000, sentMonthly: 14000,
      closedSetup: 200000, closedMonthly: 14000, lostReason: "", notes: "",
    };
    const withWin = run({ quotes: [won] });
    expect(withWin.prepared.set.candidates.map((c) => c.id)).toContain("won1");
    expect(withWin.band.matched.some((m) => m.id === "won1")).toBe(true);
    expect(withWin.band.setup!.stretch).toBeGreaterThan(run().band.setup!.stretch);
  });

  it("reports rather than hides every missing input", () => {
    const { band } = run({ settings: { ...SETTINGS, usdToZar: 0 }, comparables: [
      ...COMPARABLES,
      { ...COMPARABLES[0], id: "usd", currency: "USD" as const },
    ] });
    expect(band.degraded).toEqual(
      expect.arrayContaining(["no-fx-rate", "no-intent", "no-capex", "no-adjudication"]),
    );
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/pricing/endToEnd.test.ts`
Expected: PASS — 9 tests. If the price-loss test fails because the cap lands below the floor, that is the `minimumSetupFee` conflict rule firing; check the clamp note says "floor wins" and adjust the fixture, not the rule.

- [ ] **Step 3: Run everything**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: full suite green, no type errors, production build succeeds.

- [ ] **Step 4: Walk the real app once**

With `npm run dev` and a key set:

1. Settings → set margin 40, minimum setup fee 40000, USD→ZAR 18.
2. `/pricing/comparables` → add three market examples at R90k / R120k / R160k.
3. `/pricing` → new quote against a lead that has interactions logged.
4. Build panel → 6 surfaces, 1 integration, 3 data sources, AI core, 20 users, medium support.
5. Running cost → one R4,000 hosting line, plus an AI line.
6. Reads → refresh both. Confirm intent signals quote real record text and capex evidence has clickable sources.
7. Price → Recompute.

Expected: a setup band anchored on the three comparables with a target between floor and ceiling, a monthly band whose floor equals opex × 1.4, reasoning that names a specific signal rather than generic praise, and no unexplained degrade notes.

8. Mark it sent, then won. Return to `/pricing/comparables`.

Expected: the deal appears under "Your own closed deals". Create a second, similar quote and recompute — its footer should now name the won deal among its comparables.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/endToEnd.test.ts
git commit -m "test(pricing): end-to-end verification of the quote engine"
```

---

## Spec coverage

| Spec section | Covered by |
|---|---|
| Data model, two collections, disclosure boundary | Task 1 |
| Settings block (5 fields) | Task 1 (fields), Task 14 (UI) |
| `prices.ts`, `opex.ts` | Task 2 |
| `attributes.ts` similarity | Task 3 |
| `comparables.ts` candidate set + outcome weights | Task 4 |
| `anchor.ts` weighted percentiles, `MIN_CANDIDATES` | Task 5 |
| `bounds.ts` floors, capex multiplier, price-loss cap | Task 6 |
| `clamp.ts` | Task 7 |
| Band assembly + all seven degrade paths | Task 8 |
| Intent route | Tasks 9, 10 |
| Capex route (`web_search_20260209`, `pause_turn`) | Tasks 9, 11 |
| Adjudication route | Tasks 9, 12 |
| `pricingClient.ts` + caching of reads | Tasks 13, 17 |
| `/pricing` list + new-quote-from-lead | Task 15 |
| Quote detail: Lead, Build, Running cost | Task 16 |
| Quote detail: Reads | Task 17 |
| Quote detail: Price + close-the-loop | Task 18 |
| `/pricing/comparables` | Task 19 |
| Testing section | Tasks 2–9, 13, 20 |
| Out of scope | Not built, by design |
