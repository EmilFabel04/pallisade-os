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
