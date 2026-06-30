import type { Target } from "@/lib/types";

/** Targets still in rotation: anything not marked not_interested. */
export function eligibleTargets(targets: Target[]): Target[] {
  return targets.filter((t) => t.disposition !== "not_interested");
}

/**
 * Up to `count` unique random targets from `pool`.
 * `rng` returns a float in [0, 1); defaults to Math.random. Does not mutate `pool`.
 */
export function pickDaily(
  pool: Target[],
  count: number,
  rng: () => number = Math.random,
): Target[] {
  const remaining = [...pool];
  const out: Target[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * remaining.length);
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}
