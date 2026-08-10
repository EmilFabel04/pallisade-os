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
