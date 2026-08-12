/* Rotation guardrails. Enforced here in code, never as a prompt instruction —
   the model is not trusted to remember what it wrote last Tuesday. */

import { daysBetween } from "@/lib/utils";
import { PILLARS, FORMATS } from "./types";
import type { ContentPost, PostBrief, ContentPillar, PostFormat } from "./types";

export const PILLAR_WINDOW_DAYS = 4;
export const FORMAT_WINDOW_DAYS = 3;
export const SOURCE_WINDOW_DAYS = 21;
export const OPENER_HISTORY = 30;

/** Distinct pillars and formats one day needs: two posts that must differ. */
export const CHOICES_NEEDED = 2;

export interface RotationMemory {
  /** Pillars used within PILLAR_WINDOW_DAYS, mapped to the date used. */
  recentPillars: Map<ContentPillar, string>;
  recentFormats: Map<PostFormat, string>;
  /** "collection:id" keys used within SOURCE_WINDOW_DAYS. */
  recentSources: Map<string, string>;
  recentOpeners: string[];
  /**
   * Holds given back because the windows blocked more than the day could
   * spare. Empty on a normal day; non-empty means the run should say so.
   */
  released: { pillars: ContentPillar[]; formats: PostFormat[] };
}

const sourceKey = (collection: string, id: string) => `${collection}:${id}`;

/**
 * Give back the oldest holds until CHOICES_NEEDED options are free again.
 *
 * The windows are wider than the supply and exhaust on their own: six pillars
 * against a 4-day window at two posts a day consumes up to eight pillar-slots
 * per window, six formats against a 3-day window consumes exactly six. Three
 * consecutive days of generation blocks every option, and the brief stage is
 * then handed a constraint set with no solution — the model cannot comply,
 * both attempts are rejected, and the run dies as `brief_invalid` → 502. That
 * is precisely how 2026-08-12 failed.
 *
 * Widening the windows or shrinking them to fit is the wrong fix: either way
 * the guardrail is one busy week from deadlocking again. The guardrail exists
 * to force variety, and when variety is arithmetically impossible the best
 * available answer is the least-recently-used option — not an error.
 *
 * Oldest first, because the hold nearest to expiring is the cheapest to give
 * back; releasing yesterday's pillar would repeat the newest post. Ties break
 * on the canonical order so two runs on the same history agree.
 *
 * Mutates `blocked` and returns what it removed.
 */
function releaseOldest<T>(blocked: Map<T, string>, all: readonly T[]): T[] {
  const shortfall = CHOICES_NEEDED - (all.length - blocked.size);
  if (shortfall <= 0) return [];

  const freed = [...blocked.entries()]
    .sort(([aKey, aDate], [bKey, bDate]) =>
      aDate === bDate ? all.indexOf(aKey) - all.indexOf(bKey) : aDate < bDate ? -1 : 1)
    .slice(0, shortfall)
    .map(([key]) => key);

  for (const key of freed) blocked.delete(key);
  return freed;
}

export function buildMemory(posts: ContentPost[], today: string): RotationMemory {
  const byRecency = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

  const recentPillars = new Map<ContentPillar, string>();
  const recentFormats = new Map<PostFormat, string>();
  const recentSources = new Map<string, string>();

  for (const p of byRecency) {
    // Clamp to zero: this is NOT needed by the `age < WINDOW_DAYS` checks
    // below — they already treat every non-positive age identically, so a
    // future-dated post (timezone skew, hand-entered data) already blocks
    // now and already expires at exactly postDate + WINDOW_DAYS with or
    // without this clamp (verified empirically; a negative age does not
    // block "forever"). The clamp exists purely as forward defense: if a
    // future consumer ever reads this numeric age directly — sorting by
    // remaining cooldown, showing "days until eligible" — it gets a sane
    // non-negative value instead of a confusing negative one.
    const age = Math.max(0, daysBetween(p.date, today));
    if (age < PILLAR_WINDOW_DAYS && !recentPillars.has(p.pillar)) {
      recentPillars.set(p.pillar, p.date);
    }
    if (age < FORMAT_WINDOW_DAYS && !recentFormats.has(p.format)) {
      recentFormats.set(p.format, p.date);
    }
    if (age < SOURCE_WINDOW_DAYS) {
      for (const ref of p.sourceRefs) {
        const key = sourceKey(ref.collection, ref.id);
        if (!recentSources.has(key)) recentSources.set(key, p.date);
      }
    }
  }

  // Sources are deliberately NOT released. Running the same record twice is an
  // editorial failure the reader can see, not a rotation preference — and the
  // ledger has already dropped used records, so an empty ledger surfaces as
  // the "no material" degradation rather than as a repeat.
  const released = {
    pillars: releaseOldest(recentPillars, PILLARS),
    formats: releaseOldest(recentFormats, FORMATS),
  };

  return {
    recentPillars,
    recentFormats,
    recentSources,
    released,
    recentOpeners: byRecency
      .map((p) => p.openingLine)
      .filter(Boolean)
      .slice(0, OPENER_HISTORY),
  };
}

/** Returns violation strings. Empty means the briefs are acceptable. */
export function validateBriefs(
  briefs: PostBrief[],
  memory: RotationMemory,
): string[] {
  const out: string[] = [];

  for (const b of briefs) {
    const pillarDate = memory.recentPillars.get(b.pillar);
    if (pillarDate) {
      out.push(
        `slot ${b.slot}: pillar "${b.pillar}" was used on ${pillarDate}, inside the ` +
          `${PILLAR_WINDOW_DAYS}-day window — pick a different pillar`,
      );
    }

    const formatDate = memory.recentFormats.get(b.format);
    if (formatDate) {
      out.push(
        `slot ${b.slot}: format "${b.format}" was used on ${formatDate}, inside the ` +
          `${FORMAT_WINDOW_DAYS}-day window — pick a different format`,
      );
    }

    for (const ref of b.sourceRefs) {
      const usedOn = memory.recentSources.get(sourceKey(ref.collection, ref.id));
      if (usedOn) {
        out.push(
          `slot ${b.slot}: source ${ref.collection}/${ref.id} was already used on ` +
            `${usedOn}, inside the ${SOURCE_WINDOW_DAYS}-day window`,
        );
      }
    }
  }

  if (briefs.length === 2) {
    if (briefs[0].pillar === briefs[1].pillar) {
      out.push(`same day: both slots chose pillar "${briefs[0].pillar}" — they must differ`);
    }
    if (briefs[0].format === briefs[1].format) {
      out.push(`same day: both slots chose format "${briefs[0].format}" — they must differ`);
    }
  }

  return out;
}
