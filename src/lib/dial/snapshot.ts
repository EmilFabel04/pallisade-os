import type { DialEntry, DialList, Target } from "@/lib/types";
import { eligibleTargets, pickDaily } from "./select";

/** The snapshot for a given YYYY-MM-DD date, or null if none exists yet. */
export function findToday(dialLists: DialList[], date: string): DialList | null {
  return dialLists.find((d) => d.date === date) ?? null;
}

/** Pick up to `count` eligible targets and turn them into fresh dial entries. */
export function buildEntries(
  targets: Target[],
  count: number,
  rng: () => number = Math.random,
): DialEntry[] {
  return pickDaily(eligibleTargets(targets), count, rng).map((t) => ({
    targetId: t.id,
    label: `${t.company} — ${t.contactName}`,
    outcome: null,
  }));
}
