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
  const m = multipliers[band];
  // A zero (or negative, or non-numeric) multiplier is never a meaningful
  // instruction — it is an empty Settings field — so it is treated as neutral
  // rather than honoured, which would otherwise collapse the ceiling to the floor.
  return typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
}

/** The one bound that always exists: opex is always known. Exported so the
    UI never hand-copies this formula — a single source avoids the floor
    shown live disagreeing with the floor stored in a band. */
export function monthlyFloor(opexTotal: number, targetMarginPct: number): number {
  return Math.round(opexTotal * (1 + targetMarginPct));
}

export function computeBounds(params: BoundsParams): Bounds {
  const {
    opexTotal, targetMarginPct, minimumSetupFee,
    setupAnchor, monthlyAnchor, capexBand, multipliers, priceLosses, currency,
  } = params;

  const notes: string[] = [];
  const mult = capexMultiplier(capexBand, multipliers);

  const floor = monthlyFloor(opexTotal, targetMarginPct);
  const monthlyCeiling = monthlyAnchor
    ? Math.max(Math.round(monthlyAnchor.high * mult), Math.round(floor * 1.5))
    : Math.round(floor * 1.5);

  if (!setupAnchor) {
    return { setup: null, monthly: { floor, ceiling: monthlyCeiling }, notes };
  }

  const setupFloor = Math.max(minimumSetupFee, Math.round(setupAnchor.low));
  let setupCeiling = Math.round(setupAnchor.high * mult);

  // A deal lost specifically on price is evidence about where resistance starts.
  const lowest = priceLosses.reduce<Candidate | null>(
    (best, c) => (best === null || c.setupPrice < best.setupPrice ? c : best),
    null,
  );
  let cappedByPriceLoss = false;
  if (lowest && lowest.setupPrice < setupCeiling) {
    setupCeiling = Math.round(lowest.setupPrice);
    cappedByPriceLoss = true;
    notes.push(
      `Stretch capped at ${fmtCurrency(setupCeiling, currency)} — ${lowest.label} lost on price at that number.`,
    );
  }

  // A number someone refused does not make a loss-making deal worth taking.
  // But the note must only claim a refusal happened when one actually did —
  // this branch also fires when nothing was ever lost on price, purely from
  // the capex multiplier and minimum setup fee squeezing the ceiling down.
  if (setupCeiling < setupFloor) {
    notes.push(
      cappedByPriceLoss
        ? `Price-loss cap of ${fmtCurrency(setupCeiling, currency)} sits below the walk-away floor of ${fmtCurrency(setupFloor, currency)}; the floor wins.`
        : `The capex multiplier and the minimum setup fee squeezed the ceiling to ${fmtCurrency(setupCeiling, currency)}, below the walk-away floor of ${fmtCurrency(setupFloor, currency)}; the floor wins.`,
    );
    setupCeiling = setupFloor;
  }

  return {
    setup: { floor: setupFloor, ceiling: setupCeiling },
    monthly: { floor, ceiling: monthlyCeiling },
    notes,
  };
}
