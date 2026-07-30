/* ============================================================
   Pure filtering logic for the sent-mail follow-up audit.
   No I/O — unit-tested. Mirrors the parse.ts convention.
   ============================================================ */

/** Gmail label whose threads are Apollo mailwarming traffic, never real outreach. */
export const WARMING_LABEL = "Apollo Mailwarming";

/** A subject containing this counts as the founder's own outreach. */
export const SUBJECT_KEYWORD = "Pallisade";

/** Accepted sign-offs, lowercased. */
export const SIGNOFF_NAMES = ["emil", "emil fabel"];

/** How many trailing non-empty lines the sign-off test inspects.
 *  1 = strict last line, chosen deliberately. Raising this to ~4 turns the test
 *  into a signature-block scan (matching a name above a title line) and is the
 *  single value to change if the strict rule under-matches in practice. */
export const SIGNOFF_SEARCH_LINES = 1;

/** Common valedictions stripped when they share a line with the name. */
const VALEDICTION =
  /^(best regards|kind regards|all the best|thank you|best|thanks|cheers|regards|warmly|sincerely)\s*[,\-–—]?\s*/i;

const QUOTE_MARKERS = [
  /^>/,
  /^-{2,}\s*original message\s*-{2,}$/i,
];

/**
 * Return only the newly-written part of a message body, cutting the quoted
 * thread beneath it. Conservative on purpose: over-aggressive stripping would
 * discard a real signature and break the sign-off test.
 */
export function unquotedBody(text: string): string {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      return lines.slice(0, i).join("\n");
    }

    // Gmail attribution: "On <date> Name <addr> wrote:" — sometimes wrapped so
    // that "wrote:" lands on the following line.
    if (/^on\b/i.test(line)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/wrote:\s*$/i.test(line) || /^wrote:\s*$/i.test(next)) {
        return lines.slice(0, i).join("\n");
      }
    }

    // Outlook-style header block: a From: line immediately followed by Sent:/Date:.
    // A lone From: line is left alone — it appears in ordinary prose.
    if (/^from:\s/i.test(line) && /^(sent|date):\s/i.test((lines[i + 1] ?? "").trim())) {
      return lines.slice(0, i).join("\n");
    }
  }

  return text;
}

/** Trim a line to a bare name for comparison. */
function normalizeSignoff(line: string): string {
  return line
    .trim()
    .replace(VALEDICTION, "")
    .replace(/[.,;:!\-–—]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * True when the founder's own text ends with his sign-off.
 * Strict by design: inspects only the last SIGNOFF_SEARCH_LINES non-empty lines
 * of the unquoted body.
 */
export function signedByFounder(body: string): boolean {
  const lines = unquotedBody(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines
    .slice(-SIGNOFF_SEARCH_LINES)
    .some((l) => SIGNOFF_NAMES.includes(normalizeSignoff(l)));
}
