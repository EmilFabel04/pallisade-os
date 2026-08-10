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

  // Fix inverted range: floor > ceiling means collapse to floor
  let workingBounds = bounds;
  if (bounds.ceiling < bounds.floor) {
    notes.push(`${label} range inverted; collapsed to the ${money(bounds.floor)} floor.`);
    workingBounds = { floor: bounds.floor, ceiling: bounds.floor };
  }

  // Treat non-finite proposals as absent; substitute floor
  let targetInput = proposed.target;
  if (!Number.isFinite(targetInput)) {
    notes.push(`${label} target was not a usable number; set to the ${money(workingBounds.floor)} floor.`);
    targetInput = workingBounds.floor;
  }

  let stretchInput = proposed.stretch;
  if (!Number.isFinite(stretchInput)) {
    notes.push(`${label} stretch was not a usable number; set to the ${money(workingBounds.floor)} floor.`);
    stretchInput = workingBounds.floor;
  }

  let target = Math.round(targetInput);
  let stretch = Math.round(stretchInput);

  if (target < workingBounds.floor) {
    notes.push(`${label} target raised to the ${money(workingBounds.floor)} floor.`);
    target = workingBounds.floor;
  } else if (target > workingBounds.ceiling) {
    notes.push(`${label} target capped at the ${money(workingBounds.ceiling)} ceiling.`);
    target = workingBounds.ceiling;
  }

  if (stretch < workingBounds.floor) {
    notes.push(`${label} stretch raised to the ${money(workingBounds.floor)} floor.`);
    stretch = workingBounds.floor;
  } else if (stretch > workingBounds.ceiling) {
    notes.push(`${label} stretch capped at the ${money(workingBounds.ceiling)} ceiling.`);
    stretch = workingBounds.ceiling;
  }

  if (stretch < target) {
    notes.push(`${label} stretch raised to match the target at ${money(target)}.`);
    stretch = target;
  }

  return { triple: { floor: workingBounds.floor, target, stretch }, notes };
}
