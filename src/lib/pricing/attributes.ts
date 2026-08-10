import type { BuildAttributes } from "@/lib/types";
import { AI_DEPTHS, SUPPORT_LOADS } from "@/lib/types";

/* Weights sum to 1. buildStatus is absent on purpose: it is a floor modifier,
   not a match dimension. An already-built product is worth the same to the
   client as a new one, so it must never move the anchor. */
const WEIGHTS = {
  surfaces: 0.2,
  integrations: 0.2,
  dataSources: 0.15,
  aiDepth: 0.2,
  userCount: 0.15,
  supportLoad: 0.1,
} as const;

/** 1 when equal, falling to 0 as the gap approaches the larger of the two. */
export function numericCloseness(a: number, b: number): number {
  const denom = Math.max(a, b, 1);
  return 1 - Math.min(1, Math.abs(a - b) / denom);
}

/** Set overlap, case- and whitespace-insensitive. Two empty sets are identical. */
export function jaccard(a: string[], b: string[]): number {
  const norm = (xs: string[]) =>
    new Set(xs.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Distance between two positions on an ordered scale, normalised to 0–1. */
function ordinalCloseness(a: string, b: string, scale: readonly string[]): number {
  const ia = scale.indexOf(a);
  const ib = scale.indexOf(b);
  if (ia < 0 || ib < 0 || scale.length < 2) return 0;
  return 1 - Math.abs(ia - ib) / (scale.length - 1);
}

export function similarity(a: BuildAttributes, b: BuildAttributes): number {
  return (
    WEIGHTS.surfaces * numericCloseness(a.surfaces, b.surfaces) +
    WEIGHTS.integrations * jaccard(a.integrations, b.integrations) +
    WEIGHTS.dataSources * numericCloseness(a.dataSources, b.dataSources) +
    WEIGHTS.aiDepth * ordinalCloseness(a.aiDepth, b.aiDepth, AI_DEPTHS) +
    // Log-scaled: 20 users vs 200 is a far smaller difference than 20 vs 200,000.
    WEIGHTS.userCount *
      numericCloseness(Math.log10(1 + a.userCount), Math.log10(1 + b.userCount)) +
    WEIGHTS.supportLoad * ordinalCloseness(a.supportLoad, b.supportLoad, SUPPORT_LOADS)
  );
}
