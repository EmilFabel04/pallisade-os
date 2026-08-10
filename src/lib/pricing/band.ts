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
