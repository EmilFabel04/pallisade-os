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
