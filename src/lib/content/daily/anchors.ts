/* Concrete-detail extraction. Deliberately narrow: a post must be anchored
   to something a reader could check, and this decides what counts. */

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const PATTERNS: RegExp[] = [
  // ISO dates first, so they are not shredded by the number rule.
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // "12 June", "12 Jun 2026", "June 2026"
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "g"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, "g"),
  // Currency amounts: R120,000  $1.2m  £40k
  /\b[R$€£]\s?\d[\d,]*(?:\.\d+)?[kmb]?\b/gi,
  // Percentages and bare numbers (two or more digits, or any digit with a unit)
  /\b\d[\d,]*(?:\.\d+)?%/g,
  /\b\d[\d,]*(?:\.\d+)?\b/g,
  // Multi-word proper nouns
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
];

const QUOTES = [/"([^"\n]{4,})"/g, /“([^”\n]{4,})”/g];

export function extractAnchors(text: string): string[] {
  const found: string[] = [];

  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) found.push(m[0].trim());
  }
  for (const re of QUOTES) {
    for (const m of text.matchAll(re)) found.push(m[1].trim());
  }

  // A longer anchor that contains a shorter one makes the shorter redundant:
  // "R120,000" already covers "120,000".
  const unique = [...new Set(found)];
  return unique.filter(
    (a) => !unique.some((b) => b !== a && b.length > a.length && b.includes(a)),
  );
}
