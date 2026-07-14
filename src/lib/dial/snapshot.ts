import type { DialEntry, DialList, Target } from "@/lib/types";
import { eligibleTargets, pickDaily } from "./select";

/** The snapshot for a given YYYY-MM-DD date, or null if none exists yet. */
export function findToday(dialLists: DialList[], date: string): DialList | null {
  return dialLists.find((d) => d.date === date) ?? null;
}

/** A fresh, unactioned entry for a target, with the label denormalized now. */
function toEntry(t: Target): DialEntry {
  return {
    targetId: t.id,
    label: `${t.company} — ${t.contactName}`,
    outcome: null,
  };
}

/** Pick up to `count` eligible targets and turn them into fresh dial entries. */
export function buildEntries(
  targets: Target[],
  count: number,
  rng: () => number = Math.random,
): DialEntry[] {
  return pickDaily(eligibleTargets(targets), count, rng).map(toEntry);
}

/**
 * Redraw today's list, keeping any row that's already been actioned — those are
 * the record of the day's work, and the scorecard has already counted them.
 * Nobody already in the list is drawn again, actioned or not.
 */
export function refreshEntries(
  existing: DialEntry[],
  targets: Target[],
  count: number,
  rng: () => number = Math.random,
): DialEntry[] {
  const kept = existing.filter((e) => e.outcome != null);
  const seen = new Set(existing.map((e) => e.targetId));
  const pool = eligibleTargets(targets).filter((t) => !seen.has(t.id));
  // pickDaily caps at the pool size, so a non-positive count yields nothing.
  const fresh = pickDaily(pool, count - kept.length, rng).map(toEntry);
  return [...kept, ...fresh];
}
