/* ============================================================
   Identity redaction — pure, no model calls.

   The engine's other safety check (gate.ts's checkSpecificity) asks whether a
   detail is TRUE. This module asks whether it may be SEEN. They are different
   questions, and a real client name passes the first one perfectly: it traces
   against the source record, so nothing downstream objects to it.

   The guarantee here is structural rather than instructional — the model
   cannot publish a name it was never shown. Redaction therefore happens on
   MaterialItem.text inside collectCandidates, before extractAnchors runs and
   before any prompt is built.
   ============================================================ */

import type { DataShape } from "@/lib/types";

export const REDACTED_ORG = "a client";
export const REDACTED_PERSON = "the contact";

/**
 * Fragments shorter than this are never redacted on their own. Splitting
 * "Tom Bex" yields "Tom" and "Bex"; redacting every three-letter fragment
 * shreds ordinary prose ("the bill", "on time") and costs the post its
 * meaning. Full names are always matched whole, so this only limits the
 * bare-fragment fallback.
 */
const MIN_FRAGMENT = 4;

export interface Vocabulary {
  organisations: string[];
  people: string[];
}

function collect(rows: unknown, fields: string[]): string[] {
  const out: string[] = [];
  for (const rec of (rows ?? []) as Record<string, unknown>[]) {
    for (const f of fields) {
      const value = rec[f];
      if (typeof value === "string" && value.trim()) out.push(value.trim());
    }
  }
  return out;
}

/** Longest first, so "Kestrelmoor Capital Partners" is consumed before "Kestrelmoor". */
function unique(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}

/**
 * Every company and person the founder has recorded. Drawn from his own data
 * rather than guessed by pattern, which is what makes this precise: there is
 * no heuristic deciding whether a capitalised pair is a company.
 */
export function buildVocabulary(data: DataShape): Vocabulary {
  const d = data as unknown as Record<string, unknown>;
  return {
    organisations: unique([
      ...collect(d.leads, ["company"]),
      ...collect(d.interactions, ["company"]),
      ...collect(d.projects, ["company"]),
    ]),
    people: unique([
      ...collect(d.leads, ["contactName"]),
      ...collect(d.interactions, ["contact"]),
    ]),
  };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `\b` only fires next to a word character, so a name ending in punctuation —
 * "C++ (Pty) Ltd" — can never satisfy a trailing boundary and would silently
 * never match. Applied per side, mirroring gate.ts's phraseRegex.
 */
function nameRegex(name: string): RegExp {
  const escaped = escape(name);
  const left = /\w/.test(name[0] ?? "") ? "\\b" : "";
  const right = /\w/.test(name[name.length - 1] ?? "") ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "gi");
}

/**
 * The individual words of a full name, so "Spoke to Sarah again" is caught as
 * well as "Sarah Whitfield". Notes rarely repeat a full name, and leaving the
 * given name standing defeats the guarantee.
 */
function fragments(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const part of name.split(/\s+/)) {
      if (part.length >= MIN_FRAGMENT) out.push(part);
    }
  }
  return unique(out);
}

function replaceAll(text: string, names: string[], placeholder: string): string {
  let out = text;
  for (const name of names) {
    if (!name) continue;
    out = out.replace(nameRegex(name), placeholder);
  }
  return out;
}

/**
 * Every known name that appears in `text`, longest first.
 *
 * The gate's disclosure check and redaction MUST agree about what counts as an
 * identity — if the gate were to match on its own rule, a name redaction
 * scrubs could still be reported (or worse, one redaction misses could pass).
 * Both go through this function, so there is exactly one matching rule.
 */
export function matchesIn(text: string, vocab: Vocabulary): string[] {
  const candidates = [
    ...vocab.organisations,
    ...vocab.people,
    ...fragments(vocab.organisations),
    ...fragments(vocab.people),
  ];
  const hits = candidates.filter((name) => name && nameRegex(name).test(text));
  // A fragment already covered by a matched full name is not a separate leak.
  return unique(hits).filter(
    (a) => !hits.some((b) => b !== a && b.length > a.length && b.toLowerCase().includes(a.toLowerCase())),
  );
}

/**
 * Scrub every known company and person from `text`. Full names go first so a
 * multi-word name becomes one placeholder rather than several.
 */
export function redactText(text: string, vocab: Vocabulary): string {
  let out = replaceAll(text, vocab.organisations, REDACTED_ORG);
  out = replaceAll(out, vocab.people, REDACTED_PERSON);
  out = replaceAll(out, fragments(vocab.organisations), REDACTED_ORG);
  out = replaceAll(out, fragments(vocab.people), REDACTED_PERSON);
  // Collapse the runs the placeholders create ("a client a client Ltd").
  return out
    .replace(new RegExp(`(?:${REDACTED_ORG}[\\s,]*){2,}`, "gi"), `${REDACTED_ORG} `)
    .replace(new RegExp(`(?:${REDACTED_PERSON}[\\s,]*){2,}`, "gi"), `${REDACTED_PERSON} `)
    .replace(/\s{2,}/g, " ")
    .trim();
}
