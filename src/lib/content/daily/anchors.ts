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
  // Currency amounts: R120,000  $1.2m  £40k  €500
  // Leading boundary is a negative lookbehind, not \b: \b cannot fire before
  // a non-word symbol ($, €, £) when it's preceded by whitespace, since
  // neither side is a "word" character. The lookbehind also blocks matching
  // "R500" inside a token like "AR500" (preceding char "A" is alphanumeric).
  /(?<![A-Za-z0-9])[R$€£]\s?\d[\d,]*(?:\.\d+)?[kmb]?\b/gi,
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

  // A longer anchor that contains a shorter one makes the shorter redundant
  // ONLY when that occurrence isn't itself part of a bigger number: "R120,000"
  // covers "120,000" (flanked by "R" and nothing — not digits), and "47%"
  // covers "47" (flanked by "%" — not a digit). But "114" must not swallow
  // "14" just because the digits happen to appear as a substring: "14" in
  // "114" is flanked by "1", a digit, so it is a distinct number, not an
  // extension of the same one, and both must survive.
  const unique = [...new Set(found)];
  return unique.filter((a) => !unique.some((b) => b !== a && b.length > a.length && isRedundantWithin(a, b)));
}

/** True if `short` appears in `long` at a position that is not itself part
 * of a larger digit run — i.e. `long` is a genuine extension of `short`
 * (currency symbol, unit suffix, punctuation) rather than a coincidental
 * digit substring of an unrelated, larger number. */
function isRedundantWithin(short: string, long: string): boolean {
  let index = long.indexOf(short);
  while (index !== -1) {
    const before = index > 0 ? long[index - 1] : "";
    const after = index + short.length < long.length ? long[index + short.length] : "";
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    index = long.indexOf(short, index + 1);
  }
  return false;
}
