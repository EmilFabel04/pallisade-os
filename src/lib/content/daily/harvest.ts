/* Material harvest — pure, no model calls.

   Turns the founder's logged activity into a ranked ledger of things that
   could carry a post. The quality ceiling of the whole engine sits here:
   nothing downstream can write a specific post from vague material. */

import { daysBetween } from "@/lib/utils";
import type { DataShape } from "@/lib/types";
import { extractAnchors } from "./anchors";
import { PILLAR_KEYWORDS } from "./craft";
import type { ContentPillar, ContentPost, MaterialItem } from "./types";
import { SOURCE_WINDOW_DAYS } from "./rotation";

export const RECENT_WINDOW_DAYS = 7;
export const METRIC_SWING = 0.5;

export type LedgerMode = "fresh" | "reachback" | "news";

/** Language that marks material with something at stake. */
const CHARGED =
  /\b(?:broke|broken|failed|wrong|angry|frustrat|wasted|lost|stuck|hate|painful|embarrass|refus|blocked|missed|late|manual|again)\w*/i;

interface FieldSpec {
  collection: keyof DataShape;
  /** Fields read for text, in priority order. */
  fields: string[];
  dateField?: string;
}

/**
 * Every field name here is load-bearing: a typo harvests nothing from that
 * collection and the failure is silent — the ledger just comes back thinner.
 * All names verified against src/lib/types.ts.
 */
const SPECS: FieldSpec[] = [
  { collection: "interactions", fields: ["rawNotes", "whatTheySaid", "painPoints", "objections", "buyingSignals"], dateField: "date" },
  { collection: "painPoints", fields: ["painPoint", "workaround", "possibleSolution", "notes"] },
  { collection: "leads", fields: ["painPoint", "objection", "buyingSignal", "notes"] },
  { collection: "projects", fields: ["currentBlocker", "nextAction", "deliverables", "notes"] },
  { collection: "scorecards", fields: ["wins", "problems", "lessons", "avoidTomorrow"], dateField: "date" },
  { collection: "notes", fields: ["body"] },
];

function hintsFor(fields: string[]): ContentPillar[] {
  const out = new Set<ContentPillar>();
  for (const f of fields) {
    for (const rule of PILLAR_KEYWORDS) {
      if (rule.match.test(f)) rule.pillars.forEach((p) => out.add(p));
    }
  }
  return [...out];
}

function recordDate(rec: Record<string, unknown>, dateField?: string): string {
  const raw =
    (dateField && (rec[dateField] as string)) ||
    (rec.updatedAt as string) ||
    (rec.createdAt as string) ||
    "";
  return raw.slice(0, 10);
}

export function collectCandidates(data: DataShape): MaterialItem[] {
  const out: MaterialItem[] = [];

  for (const spec of SPECS) {
    const rows = (data[spec.collection] ?? []) as unknown as Record<string, unknown>[];
    for (const rec of rows) {
      const usedFields: string[] = [];
      const parts: string[] = [];
      for (const f of spec.fields) {
        const value = rec[f];
        if (typeof value === "string" && value.trim().length > 0) {
          parts.push(value.trim());
          usedFields.push(f);
        }
      }
      if (parts.length === 0) continue;

      const text = parts.join(" — ");
      out.push({
        collection: spec.collection as string,
        id: String(rec.id),
        date: recordDate(rec, spec.dateField),
        text,
        anchors: extractAnchors(text),
        pillarHints: hintsFor(usedFields),
        score: 0,
      });
    }
  }

  // Completed milestones read as build-log material.
  for (const m of (data.milestones ?? []) as unknown as Record<string, unknown>[]) {
    if (m.status !== "done" || typeof m.name !== "string" || !m.name.trim()) continue;
    const text = `Milestone completed: ${m.name}`;
    out.push({
      collection: "milestones",
      id: String(m.id),
      date: recordDate(m, "endDate"),
      text,
      anchors: extractAnchors(text),
      pillarHints: ["build-log", "proof"],
      score: 0,
    });
  }

  // Metric entries only when the value genuinely moved.
  const metrics = (data.metricEntries ?? []) as unknown as {
    id: string; metric: string; date: string; value: number;
  }[];
  const byMetric = new Map<string, typeof metrics>();
  for (const e of metrics) {
    byMetric.set(e.metric, [...(byMetric.get(e.metric) ?? []), e]);
  }
  for (const [metric, entries] of byMetric) {
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const trailing = sorted.slice(0, -1).filter((e) => daysBetween(e.date, latest.date) <= 7);
    if (trailing.length === 0) continue;
    const mean = trailing.reduce((a, e) => a + e.value, 0) / trailing.length;
    if (mean === 0) continue;
    if (Math.abs(latest.value - mean) / mean <= METRIC_SWING) continue;

    const text = `${metric} moved to ${latest.value} against a recent average of ${mean.toFixed(1)}`;
    out.push({
      collection: "metricEntries",
      id: latest.id,
      date: latest.date,
      text,
      anchors: extractAnchors(text),
      pillarHints: ["proof"],
      score: 0,
    });
  }

  return out;
}

export function scoreItem(item: MaterialItem, today: string): number {
  const age = Math.max(0, daysBetween(item.date, today));
  const recency = Math.max(0, 20 - age); //                     0-20
  const specificity = Math.min(item.anchors.length, 4) * 8; //  0-32
  const charge = CHARGED.test(item.text) ? 12 : 0; //           0 or 12
  const substance = Math.min(item.text.length / 40, 10); //     0-10
  return recency + specificity + charge + substance;
}

export function buildLedger(
  data: DataShape,
  posts: ContentPost[],
  today: string,
): { items: MaterialItem[]; mode: LedgerMode } {
  const usedKeys = new Set<string>();
  for (const p of posts) {
    if (daysBetween(p.date, today) >= SOURCE_WINDOW_DAYS) continue;
    for (const ref of p.sourceRefs) usedKeys.add(`${ref.collection}:${ref.id}`);
  }

  const all = collectCandidates(data)
    .filter((i) => !usedKeys.has(`${i.collection}:${i.id}`))
    .map((i) => ({ ...i, score: scoreItem(i, today) }))
    .sort((a, b) => b.score - a.score);

  const fresh = all.filter((i) => i.date && daysBetween(i.date, today) <= RECENT_WINDOW_DAYS);
  if (fresh.length > 0) return { items: fresh, mode: "fresh" };
  if (all.length > 0) return { items: all, mode: "reachback" };
  return { items: [], mode: "news" };
}
