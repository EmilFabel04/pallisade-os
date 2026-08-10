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
