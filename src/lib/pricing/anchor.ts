import type { Candidate } from "./comparables";

/** Below this there is no anchor. Two data points are an anecdote. */
export const MIN_CANDIDATES = 3;

export interface Anchor {
  low: number;
  mid: number;
  high: number;
}

/**
 * Weighted percentile: sort ascending by value, accumulate weight, and return
 * the value at which the running total first crosses the given fraction of the
 * total weight. A heavier candidate therefore pulls the percentile toward its
 * own price, which is how an own won deal outranks a published market number.
 */
export function weightedPercentile(
  points: { value: number; weight: number }[],
  fraction: number,
): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return sorted[0].value;

  const target = total * fraction;
  let running = 0;
  for (const p of sorted) {
    running += p.weight;
    if (running >= target) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

export function anchorFrom(
  candidates: Candidate[],
  pick: (c: Candidate) => number,
): Anchor | null {
  if (candidates.length < MIN_CANDIDATES) return null;
  const points = candidates.map((c) => ({ value: pick(c), weight: c.weight }));
  return {
    low: weightedPercentile(points, 0.25),
    mid: weightedPercentile(points, 0.5),
    high: weightedPercentile(points, 0.75),
  };
}
