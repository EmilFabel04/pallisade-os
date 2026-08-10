# Pricing calculator

**Date:** 2026-08-10
**Status:** approved

## Problem

Every deal is priced from scratch, in the founder's head, against no record. There is
nowhere to see what a build of a given size has cleared before, no floor under the
monthly retainer, and no structured read on whether a particular client can and will
pay more than the last one.

Two halves are missing and they have opposite characters. The **monthly** retainer is
arithmetic — it must cover real running cost plus a margin, and getting it wrong bleeds
quietly for the life of the contract. The **setup** fee is judgement — it is where the
cash is made, and the right number depends on what comparable solutions cost and on how
badly this particular client wants it.

Pricing on hours is explicitly rejected. The founder is solo; hours are not cash, and an
already-built product is worth the same to a client whether it took a week or a year.
Price is anchored on comparable solutions and on the client's capacity to pay.

## Decisions

- **Per-deal quote engine**, not a rate card. A quote starts from a Lead.
- **No hours anywhere.** A build is described by attributes; price comes from comparables.
- **Deterministic bounds, AI adjudication inside them.** Code owns the floors and the
  comparable-derived range. Claude places target and stretch within that range and writes
  the reasoning. Out-of-range proposals are clamped and the clamp is shown.
- **Capex is deterministic, intent is judgement.** Ability to pay is an objective capacity
  band, so it is a code multiplier. Willingness to pay is a read on a person, so it is
  Claude's input.
- **Licensing lowers the floor, not the price.** `buildStatus` never shrinks the anchor —
  it drops the floor, and the widened gap is shown as margin headroom.
- **Won and lost quotes are the comparables.** They are derived from `quotes`, never
  copied, so there is nothing to keep in sync.
- **Degrade, never block.** A failed AI read produces a deterministic band with a note,
  not an error page.

## Data model

Two new collections, registered in `DataShape` (`src/lib/types.ts`) and `COLLECTIONS`
(`src/lib/db/sqlite.ts`) exactly as `milestones` was.

### Shared vocabulary

A quote and a comparable describe a build the same way. That is the only reason matching
works.

```ts
export const BUILD_STATUSES = ["new", "adapt existing", "license as-is"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const AI_DEPTHS = ["none", "light", "core"] as const;
export type AiDepth = (typeof AI_DEPTHS)[number];

export const SUPPORT_LOADS = ["low", "medium", "high"] as const;
export type SupportLoad = (typeof SUPPORT_LOADS)[number];

export interface BuildAttributes {
  buildStatus: BuildStatus;
  surfaces: number;        // screens / sections
  integrations: string[];  // named third parties, e.g. ["Gmail", "Xero"]
  dataSources: number;
  aiDepth: AiDepth;
  userCount: number;
  supportLoad: SupportLoad;
}
```

Seven fields, deliberately. Enough to say "a six-screen thing with two integrations and
AI at its core" and have that mean something against a comparable.

### `comparables`

Market examples the founder records and reference builds he authors. **Own deals are not
stored here** — they are derived from `quotes`.

```ts
export const COMPARABLE_KINDS = ["market", "reference"] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];

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
```

### `quotes`

```ts
export const QUOTE_STATUSES = ["draft", "sent", "won", "lost"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const LOST_REASONS = ["price", "timing", "fit", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export interface OpexLine {
  id: string;
  label: string;
  monthlyCost: number;   // ZAR
}

export interface AiUsageLine {
  model: string;                        // key into MODEL_PRICES
  runsPerDay: number;
  inputTokensPerRun: number;
  outputTokensPerRun: number;
  inputPriceOverride: number | null;    // USD per 1M tokens
  outputPriceOverride: number | null;   // USD per 1M tokens
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
  lostReason: LostReason | "";
  notes: string;
}
```

`lostReason` exists because a deal lost on timing must not drag the price ceiling down.
Only `"price"` losses inform the ceiling.

### Read shapes

```ts
export interface IntentRead {
  score: number;                                  // 0–100
  band: "cold" | "warm" | "hot";
  signals: { quote: string; weight: number }[];   // quote = verbatim CRM text
  risks: string[];
  generatedAt: string;
}

export interface CapexRead {
  band: "unknown" | "micro" | "small" | "mid" | "enterprise";
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
  similarity: number;   // 0–1
  weight: number;       // similarity × outcome weight
}
```

`matched` lists **anchor contributors only**. Price-losses are not anchor contributors;
where one caps the ceiling, that is reported through `clamps`.

```ts

export interface PriceBand {
  setup: PriceTriple | null;    // null when there is no anchor
  monthly: PriceTriple;         // always computable — opex is always known
  anchor: { low: number; mid: number; high: number } | null;
  matched: MatchedComparable[];
  clamps: string[];             // human-readable, shown in the UI
  degraded: string[];           // which inputs were missing
  reasoning: string;
  computedAt: string;
}
```

### Settings

`Settings` gains a pricing block:

```ts
targetMarginPct: number;    // e.g. 0.4 — margin the monthly must clear over opex
minimumSetupFee: number;    // ZAR — absolute walk-away
usdToZar: number;           // market comparables are usually quoted in USD
capexMultipliers: { micro: number; small: number; mid: number; enterprise: number };
```

Defaults in `seed.ts`: `targetMarginPct` 0.4, `capexMultipliers` `{ micro: 0.7,
small: 1.0, mid: 1.4, enterprise: 2.0 }`. `minimumSetupFee` and `usdToZar` have no
sensible default and seed to `0`, which the engine treats as **unset**: a `usdToZar` of 0
excludes USD comparables from matching with a `degraded` note, and a `minimumSetupFee` of
0 means the setup floor comes from the anchor alone.

### Disclosure boundary

Both collections carry company-attributable money. Following
`docs/superpowers/specs/2026-08-06-disclosure-boundary-design.md`:

- **Excluded** from the content engine's `collectCandidates` in `harvest.ts`, for the same
  reason `metricEntries` is — otherwise daily posts leak what the founder charges.
- **Included** in `AdvisorSnapshot`. Knowing what was quoted to a company is exactly what
  the Sales Advisor needs.

## The pricing engine

`src/lib/pricing/` — pure functions, no I/O, unit-tested.

### `prices.ts` — model price table

USD per 1M tokens, input / output:

| Model | Input | Output |
|---|---|---|
| `claude-opus-5` | 5.00 | 25.00 |
| `claude-sonnet-5` | 3.00 | 15.00 |
| `claude-sonnet-4-6` | 3.00 | 15.00 |
| `claude-haiku-4-5` | 1.00 | 5.00 |

Standard rates, not promotional ones — Sonnet 5 carries an introductory $2/$10 through
2026-08-31, and quoting a multi-year retainer against a discount that expires in weeks is
the exact error this table exists to prevent. `AiUsageLine` overrides win when set, so a
stale table never silently misprices a quote.

### `opex.ts` — monthly running cost

```
aiMonthlyUsd = runsPerDay × 30.44 × ( inputTokensPerRun / 1e6 × inputPrice
                                    + outputTokensPerRun / 1e6 × outputPrice )
monthlyCash  = Σ opexLines.monthlyCost + aiMonthlyUsd × usdToZar
```

30.44 is the mean days per month. Returns `{ fixed, ai, total, breakdown }` so the UI can
show what drives the number.

### `attributes.ts` — similarity

Weighted, normalised to 0–1. `buildStatus` is excluded — it is a floor modifier, not a
match dimension.

| Field | Weight | Distance |
|---|---|---|
| `surfaces` | 0.20 | `1 − min(1, \|a−b\| / max(a, b, 1))` |
| `integrations` | 0.20 | Jaccard overlap on lower-cased names |
| `dataSources` | 0.15 | same numeric form as `surfaces` |
| `aiDepth` | 0.20 | `1 − ordinalDistance / 2` |
| `userCount` | 0.15 | numeric form on `log10(1 + n)` |
| `supportLoad` | 0.10 | `1 − ordinalDistance / 2` |

`ordinalDistance` is the absolute difference of the two values' indices in their `as const`
array, so `none`↔`core` is 2 and `light`↔`core` is 1.

### `comparables.ts` — building the candidate set

The set is the union of stored `comparables` and own deals derived from `quotes` with
status `won` or `lost`, using `closedSetup`/`closedMonthly` for wins and
`sentSetup`/`sentMonthly` for losses. USD entries convert at `usdToZar`.

Each candidate carries `weight = similarity × outcomeWeight`:

| Kind | Outcome weight | Rationale |
|---|---|---|
| Own won deal | 1.0 | The only proof of what actually clears |
| Market example | 0.7 | Real but not yours |
| Reference build | 0.6 | Your own authored anchor |

**Lost deals are excluded from the anchor entirely.** They inform only the ceiling cap
below.

### `anchor.ts` — the comparable-derived range

Requires **at least 3 candidates with similarity ≥ 0.5**. Below that there is no anchor
and `PriceBand.setup` is `null`. The tool asks for more comparables rather than inventing
a number.

With an anchor: weighted 25th / 50th / 75th percentiles of `setupPrice`, giving
`{ low, mid, high }`. Weighted percentile is computed by sorting candidates ascending by
price, accumulating `weight`, and taking the price at which the running total first
crosses the given fraction of the total weight. The same computation over `monthlyPrice`
gives the monthly anchor, from the same candidate set — so the two anchors exist or are
absent together.

### `bounds.ts` — floors and ceilings

```
monthlyFloor   = round( opex.total × (1 + targetMarginPct) )          // hard
setupFloor     = anchor ? max(minimumSetupFee, anchor.low) : minimumSetupFee
setupCeiling   = anchor.high × capexMultiplier[capex.band]            // unknown → 1.0
monthlyCeiling = anchor ? max( monthlyAnchor.high × capexMultiplier, monthlyFloor × 1.5 )
                        : monthlyFloor × 1.5
```

`monthlyFloor` is the only bound that exists unconditionally, because opex is always
known. Every other bound depends on an anchor.

**The price-loss cap.** If any own quote with `status: "lost"` and `lostReason: "price"`
matches at similarity ≥ 0.5, `setupCeiling` is capped at the lowest such `sentSetup`. If
that cap lands below `setupFloor`, the floor wins and a clamp note records the conflict —
a floor is a walk-away, and evidence that a number was refused does not make a
loss-making deal worth taking.

**Licensing.** `buildStatus` never touches the anchor. It affects `minimumSetupFee`'s
relevance only in that an already-built product has no build cost to recover, so the
whole floor-to-target span reads as margin. The UI labels it as such.

`clamp.ts` behaviour: force `floor ≤ target ≤ stretch ≤ ceiling`, and push each adjustment
onto `clamps` with a readable sentence.

## AI stages

Three narrow routes under `src/app/api/pricing/`, following the existing `/api/*` pattern
(Anthropic SDK, module-level `MODEL` constant). Client access via
`src/lib/pricingClient.ts`, following `contentClient.ts`.

All three use `claude-sonnet-5` and **structured outputs** (`output_config.format` with a
JSON schema) rather than parsing JSON out of prose, so a malformed response is rejected at
the API layer and retried rather than reaching the engine.

| Route | Input | Output | Effort |
|---|---|---|---|
| `POST /api/pricing/intent` | `{ leadId }` | `IntentRead` | `low` |
| `POST /api/pricing/capex` | `{ company, industry, companyType }` | `CapexRead` | `medium` |
| `POST /api/pricing/adjudicate` | bounds, anchor, matched summary, intent, capex | `{ setup: { target, stretch }, monthly: { target, stretch }, reasoning }` | `high` |

**Intent** reads the Lead and its Interactions **server-side** from the leadId; the client
never sends CRM content. Every entry in `signals` must quote verbatim text from a record,
so a score of 80 can always be traced to what was actually said.

**Capex** uses `web_search_20260209` — the dynamic-filtering variant, supported on Sonnet 5,
which filters results before they reach context. It needs the `pause_turn` resume loop
already implemented in `content/route.ts` and `brain/route.ts`; that code is reused, not
rewritten. Every claim carries a source URL.

**Adjudicate** receives the bounds but has no authority over them. Its output passes
through `clamp.ts` before it is stored.

**Both reads are cached** onto the quote with `generatedAt`. Opening a saved quote costs
nothing; re-running is an explicit button, or happens when the linked lead changes. This
also keeps the outbound company lookup a deliberate act rather than something that fires
on page load.

## Failure behaviour

The engine degrades; it never blocks. A pricing tool that refuses to produce a number
because a web search timed out is worse than useless before a call.

| Failure | Behaviour |
|---|---|
| Fewer than 3 matched comparables | `setup: null`, `degraded: ["no-anchor"]`. UI prompts to add comparables. Monthly still computed. |
| `usdToZar` unset | USD comparables excluded; `degraded: ["no-fx-rate"]`. |
| Intent route fails | `intent: null`, `degraded: ["no-intent"]`. Adjudication proceeds on capex alone. |
| Capex route fails or finds nothing | `band: "unknown"`, multiplier 1.0, `degraded: ["no-capex"]`. |
| Adjudication fails twice | Deterministic band, `degraded: ["no-adjudication"]`. Setup: `target = anchor.mid` clamped into range, `stretch = setupCeiling`. Monthly: `target = monthlyFloor × 1.15`, `stretch = monthlyCeiling`. With no anchor, only the monthly fallback applies. |
| Adjudication returns out-of-bounds | Clamped, with each clamp shown in `clamps`. |
| No lead linked | Quote cannot be created. The list view requires picking a lead first. |

## UI

Built from existing primitives — `PageHeader`, `Panel`, `Field`, `Detail`, `Badge`,
`EmptyState`, `Modal` — following the `/leads` list-plus-detail pattern.

**`/pricing`** — quotes list: company, status chip, setup target, monthly target, updated.
Filter by status. "New quote" picks a lead first.

**Quote detail** — five panels, in fill order:

1. **Lead** — company, quality, estimated value, last contact, read live.
2. **Build** — the seven attributes.
3. **Running cost** — opex lines plus the AI usage line, showing monthly cash and the
   floor it implies.
4. **Reads** — two collapsed cards, each with Refresh and a timestamp. Intent shows the
   score with its quoted CRM evidence; capex shows the band with cited sources.
5. **Price** — setup and monthly as rows, floor / target / stretch as columns, monospace
   numerals (`tnum`), crimson on target. Clamps inline, e.g. *"stretch capped at R140k —
   Kestrelmoor lost on price at that number."* Reasoning underneath. When `setup` is null,
   the panel shows the prompt to add comparables instead of numbers.

**Actions close the loop.** *Mark sent* captures `sentSetup`/`sentMonthly`. *Won* captures
`closedSetup`/`closedMonthly`; *Lost* captures the reason. That is the moment a quote
becomes a comparable — the library is fed by finishing quotes, not by separate data entry.

**`/pricing/comparables`** — market examples and reference builds (add / edit / delete),
plus a read-only list of own won and lost deals derived from quotes, so the full evidence
set is visible without history being editable.

**Settings** gains a Pricing block for the five fields above.

## Files

```
src/lib/pricing/prices.ts            model price table
src/lib/pricing/opex.ts              monthly running cost
src/lib/pricing/attributes.ts        similarity
src/lib/pricing/comparables.ts       candidate set + weighting
src/lib/pricing/anchor.ts            weighted percentiles
src/lib/pricing/bounds.ts            floors, ceilings, price-loss cap
src/lib/pricing/clamp.ts             clamp + clamp notes
src/lib/pricingClient.ts             client adapter
src/app/api/pricing/intent/route.ts
src/app/api/pricing/capex/route.ts
src/app/api/pricing/adjudicate/route.ts
src/app/pricing/page.tsx
src/app/pricing/comparables/page.tsx
src/components/pricing/*             quote detail panels
```

Modified: `src/lib/types.ts` (collections, entities, Settings), `src/lib/db/sqlite.ts`
(`COLLECTIONS`), `src/lib/seed.ts` (settings defaults), `src/lib/content/harvest.ts`
(exclusion), `src/app/settings/page.tsx` (pricing block).

## Testing

Vitest, matching the existing suite.

**Engine (pure, unit-tested):**

- `opex` — fixed lines, AI token arithmetic, override precedence, FX conversion.
- `attributes` — each field's distance function; identical attributes score 1.0;
  maximally different score near 0; Jaccard on integrations is case-insensitive.
- `comparables` — outcome weighting; lost deals excluded from the candidate set; USD
  conversion; USD entries dropped when `usdToZar` is unset.
- `anchor` — weighted percentiles; returns null under 3 matches; returns null when
  matches exist but all fall below similarity 0.5.
- `bounds` — monthly floor is never breached; setup floor respects `minimumSetupFee`;
  capex multipliers applied per band; `unknown` uses 1.0; price-loss cap applies only for
  `lostReason: "price"`; the cap-below-floor conflict resolves to the floor and records a
  clamp; with no anchor, `monthlyCeiling` falls back to `monthlyFloor × 1.5` and no setup
  bounds are produced.
- `clamp` — target and stretch forced into range, ordering enforced, one readable note
  per adjustment.

**Routes (fixture-driven, no live API):** request shaping for each of the three routes,
schema rejection handling, and the clamp boundary — an adjudication fixture proposing a
stretch above the ceiling must come back clamped with a note.

**End-to-end:** one run against a seeded lead with seeded comparables, asserting a
complete `PriceBand`, in the manner of `e26622e` for the daily engine.

## Out of scope

Deliberately not built: proposal or contract document generation; good/better/best
packaging tiers; a negotiation brief; hourly or time-and-materials pricing; currencies
beyond ZAR and USD; auto-creating a Project when a quote is won; live market-rate research
at quote time (the comparables library is the anchor).
