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
