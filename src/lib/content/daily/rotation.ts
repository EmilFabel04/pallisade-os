/* Rotation guardrails. Enforced here in code, never as a prompt instruction —
   the model is not trusted to remember what it wrote last Tuesday. */

import { daysBetween } from "@/lib/utils";
import type { ContentPost, PostBrief, ContentPillar, PostFormat } from "./types";

export const PILLAR_WINDOW_DAYS = 4;
export const FORMAT_WINDOW_DAYS = 3;
export const SOURCE_WINDOW_DAYS = 21;
export const OPENER_HISTORY = 30;

export interface RotationMemory {
  /** Pillars used within PILLAR_WINDOW_DAYS, mapped to the date used. */
  recentPillars: Map<ContentPillar, string>;
  recentFormats: Map<PostFormat, string>;
  /** "collection:id" keys used within SOURCE_WINDOW_DAYS. */
  recentSources: Map<string, string>;
  recentOpeners: string[];
}

const sourceKey = (collection: string, id: string) => `${collection}:${id}`;

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

  return {
    recentPillars,
    recentFormats,
    recentSources,
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
