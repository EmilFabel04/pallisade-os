/* Material harvest — pure, no model calls.

   Turns the founder's logged activity into a ranked ledger of things that
   could carry a post. The quality ceiling of the whole engine sits here:
   nothing downstream can write a specific post from vague material. */

import { daysBetween } from "@/lib/utils";
import type { DataShape } from "@/lib/types";
import { extractAnchors } from "./anchors";
import { buildVocabulary, redactText } from "./redact";
import { PILLAR_KEYWORDS } from "./craft";
import type { ContentPillar, ContentPost, MaterialItem } from "./types";
import { SOURCE_WINDOW_DAYS } from "./rotation";

export const RECENT_WINDOW_DAYS = 7;

export type LedgerMode = "fresh" | "reachback" | "news";

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
 *
 * The omissions are equally load-bearing. These fields are excluded because
 * they cannot be published, not because they are uninteresting — they are the
 * most interesting material here, which is exactly the problem. Anything the
 * ledger carries reaches the brief prompt, the source texts and the draft, so
 * the cheapest place to keep something unpublishable out of a post is to keep
 * it out of the ledger. Do not add them back without re-reading
 * docs/superpowers/specs/2026-08-06-disclosure-boundary-design.md:
 *
 *   interactions.rawNotes     private, unstructured, his own reactions
 *   interactions.whatTheySaid verbatim client quotes — attributable by nature
 *   scorecards.problems       unresolved self-critique
 *   scorecards.avoidTomorrow  unresolved self-critique
 *   projects.currentBlocker   a live vulnerability, by definition unresolved
 *
 * The metricEntries collection is omitted from collectCandidates entirely for
 * the same reason; see the note where it used to be handled.
 */
const SPECS: FieldSpec[] = [
  { collection: "interactions", fields: ["painPoints", "objections", "buyingSignals"], dateField: "date" },
  { collection: "painPoints", fields: ["painPoint", "workaround", "possibleSolution", "notes"] },
  { collection: "leads", fields: ["painPoint", "objection", "buyingSignal", "notes"] },
  { collection: "projects", fields: ["nextAction", "deliverables", "notes"] },
  { collection: "scorecards", fields: ["wins", "lessons"], dateField: "date" },
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
  // Built once. Every text below is scrubbed through it BEFORE extractAnchors
  // runs — anchors derived from unredacted text would carry the very name the
  // text no longer contains, and anchors travel into the brief and the draft.
  const vocab = buildVocabulary(data);

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

      const text = redactText(parts.join(" — "), vocab);
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
    // Redacted like everything else: a milestone is routinely named after the
    // client it was delivered for.
    const text = redactText(`Milestone completed: ${m.name}`, vocab);
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

  // metricEntries is deliberately NOT harvested.
  //
  // It used to emit "<metric> moved to <value> against a recent average of
  // <mean>", which publishes his commercial position directly — the worked
  // example that prompted this was "MRR moved to 0 against a recent average
  // of 0". There is no redaction that fixes it: the number IS the disclosure,
  // so the collection is excluded rather than filtered.

  return out;
}

export function scoreItem(item: MaterialItem, today: string): number {
  const age = Math.max(0, daysBetween(item.date, today));
  const recency = Math.max(0, 20 - age); //                     0-20
  const specificity = Math.min(item.anchors.length, 4) * 8; //  0-32
  const substance = Math.min(item.text.length / 40, 10); //     0-10
  // There is deliberately no "charge" term. A +12 bonus for text matching
  // broke|failed|wasted|lost|stuck|embarrass|missed|late ranked his worst
  // days highest, which is precisely how the most exposing material kept
  // winning the day's slot. Specificity, not distress, is what earns a post.
  return recency + specificity + substance;
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
