import type { Milestone } from "@/lib/types";
import { addDaysISO, daysBetween } from "@/lib/utils";

export interface GanttRange {
  start: string; // ISO YYYY-MM-DD, always a Monday
  end: string;   // ISO YYYY-MM-DD, always a Sunday
}

/** Minimum rendered bar width in px, so a one-day milestone stays visible. */
const MIN_BAR_PX = 4;

/** 0 = Monday … 6 = Sunday */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7;
}

const startOfWeek = (iso: string) => addDaysISO(iso, -weekdayIndex(iso));
const endOfWeek = (iso: string) => addDaysISO(iso, 6 - weekdayIndex(iso));

/** A milestone contributes to the timeline only when it has both dates. */
function isDated(m: Milestone): m is Milestone & { startDate: string; endDate: string } {
  return !!m.startDate && !!m.endDate;
}

/**
 * The chart's date domain: earliest start to latest end across every dated
 * milestone, padded out to whole Monday→Sunday weeks so the column grid lines
 * land on week boundaries.
 *
 * Returns null when nothing is dated — the caller renders an empty state
 * rather than an invalid domain.
 */
export function ganttRange(milestones: Milestone[]): GanttRange | null {
  const dated = milestones.filter(isDated);
  if (dated.length === 0) return null;

  let min = dated[0].startDate;
  let max = dated[0].endDate;
  for (const m of dated) {
    if (m.startDate < min) min = m.startDate;
    if (m.endDate > max) max = m.endDate;
  }

  return { start: startOfWeek(min), end: endOfWeek(max) };
}

/** Total inclusive days in the domain. */
export function rangeDays(range: GanttRange): number {
  return daysBetween(range.start, range.end) + 1;
}

/**
 * Pixel position and width of a milestone's bar within `width`.
 * Returns null for an undated milestone (listed without a bar) or a
 * zero width (the first render, before ResizeObserver has measured).
 */
export function barGeometry(
  m: Milestone,
  range: GanttRange,
  width: number,
): { x: number; w: number } | null {
  if (!isDated(m) || width <= 0) return null;

  const total = rangeDays(range);
  const perDay = width / total;

  const rawX = daysBetween(range.start, m.startDate) * perDay;
  const rawW = (daysBetween(m.startDate, m.endDate) + 1) * perDay;

  const x = Math.max(0, Math.min(rawX, width));
  const w = Math.max(MIN_BAR_PX, Math.min(rawW, width - x));

  return { x, w };
}
