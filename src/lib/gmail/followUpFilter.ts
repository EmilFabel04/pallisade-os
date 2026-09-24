/* ============================================================
   Pure filter: which follow-up recipients the founder has already
   dismissed. No I/O — unit-tested. Mirrors sentScan.ts's convention of
   taking "now" as a parameter rather than reading the clock.
   ============================================================ */

import type { FollowUpState } from "@/lib/types";
import type { FollowUp } from "./sentScan";

/**
 * True when the founder has dismissed this recipient: marked handled
 * outright, or snoozed with `until` still in the future.
 *
 * `todayIso` and `state.until` are both plain ISO *date* strings
 * (`YYYY-MM-DD`, as `todayISO()`/`addDaysISO()` in lib/utils.ts produce),
 * compared lexicographically.
 *
 * Boundary: a snooze hides strictly while `until > todayIso`. The day
 * `until` itself arrives, the recipient reappears — "hidden through
 * yesterday", not "hidden through today" — matching `isPast`/`isOverdue`
 * in lib/utils.ts, where a date equal to today does not yet count as past.
 */
export function isDismissed(state: FollowUpState | undefined, todayIso: string): boolean {
  if (!state) return false;
  if (state.status === "handled") return true;
  return (state.until ?? "") > todayIso;
}

/** Every follow-up the founder has not dismissed, in their original order. */
export function visibleFollowUps(
  followUps: FollowUp[],
  states: FollowUpState[],
  todayIso: string,
): FollowUp[] {
  const byEmail = new Map(states.map((s) => [s.email, s]));
  return followUps.filter((f) => !isDismissed(byEmail.get(f.email), todayIso));
}
