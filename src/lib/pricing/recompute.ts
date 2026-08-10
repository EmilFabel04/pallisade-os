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

  // `bounds.notes` exists to explain a clamp to the founder (e.g. "capped at
  // R150,000 — Kestrelmoor lost on price at that number") — it can name another
  // client. That is provenance for a human reading the price band, not a
  // briefing for the model, so it is emptied here; the numeric floors and
  // ceilings the model needs to respect travel through untouched.
  const bounds = { ...prepared.bounds, notes: [] };

  return {
    company,
    bounds,
    anchor: prepared.setupAnchor,
    matched,
    intent,
    capex,
    buildStatus,
  };
}
