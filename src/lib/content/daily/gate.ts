/* The anti-slop gate. Pure, no model calls.

   Every failure returns a specific, actionable detail. "Make it better" is
   never sent back to the model — the revise stage gets a named defect list. */

import { measure, compare, splitParagraphs, splitSentences, type VoiceStats } from "@/lib/content/voice";
import { AI_TELL_PHRASES, AI_TELL_PATTERNS } from "./craft";
import { extractAnchors } from "./anchors";
import type { EditorialCheck, SourceRef } from "./types";

export const BROETRY_THRESHOLD = 0.6;

/**
 * Absolute floor below which sentence rhythm reads as machine-uniform no
 * matter whose baseline it is judged against. `compare()` in voice.ts is
 * profile-relative only (`draft < profile - 0.15`), which cannot fire when
 * the profile's own burstiness is already <= 0.15 — the cold-start case
 * (profileFromSamples([]) yields ZERO_STATS, burstiness 0) and any founder
 * whose samples genuinely measure as uniform, which is precisely the person
 * this check exists to help. The value is the floor cited in the AI-detection
 * literature referenced by the design spec.
 */
export const BURSTINESS_FLOOR = 0.3;

export interface GateInput {
  body: string;
  sourceRefs: SourceRef[];
  /** Raw text of every record cited in sourceRefs, for anchor tracing. */
  sourceTexts: string[];
  profile: VoiceStats;
  neverSay: string[];
  recentOpeners: string[];
}

/** Strip case, punctuation and digits so two openers of the same shape collide. */
export function normaliseOpener(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\w\s#]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

/**
 * The whole first line of the body that has any actual content — what
 * `ContentPost.openingLine` denotes (see rotation.ts, which stores and
 * replays exactly this string in `recentOpeners`) — not the first sentence.
 * A first line can hold more than one sentence ("Reconciliation took 14
 * hours. That was absurd."); comparing only its first sentence against a
 * stored opener that captured the whole line would silently miss the
 * collision. Exported so any future producer of `openingLine` derives it
 * identically, keeping producer and consumer of the denormalised field in
 * agreement.
 *
 * Leading lines with no letter or digit — a blank line, a whitespace-only
 * line, a "---" separator — are skipped rather than taken literally. Taking
 * the unconditional first line meant a model emitting a stray leading
 * newline produced an empty opener, and checkOpener's `if (!shape)` guard
 * then reported the check as passing ("no opening line to compare") while
 * doing nothing — collisions went undetected instead of being degraded.
 */
export function firstLine(body: string): string {
  for (const line of body.split(/\n+/)) {
    const trimmed = line.trim();
    if (/[A-Za-z0-9]/.test(trimmed)) return trimmed;
  }
  return "";
}

function ok(rule: string, detail: string): EditorialCheck {
  return { rule, passed: true, detail };
}
function fail(rule: string, detail: string): EditorialCheck {
  return { rule, passed: false, detail };
}

/**
 * Curly (U+2019) and modifier-letter (U+02BC) apostrophes fold to the plain
 * ASCII one. Models routinely emit the typographic apostrophe — it is the
 * common case, not the edge case — and several tells ("here's the thing",
 * "it's important to note", "in today's fast-paced", "i've been thinking a
 * lot about") plus the negative-parallelism pattern (`it'?s`) are written
 * with a straight one, so without this fold they silently never match.
 * Applied once, centrally, to both the body and the phrase before either
 * side is compared, rather than adding duplicate curly-quote phrase entries.
 */
function foldApostrophes(s: string): string {
  return s.replace(/[’ʼ]/g, "'");
}

/**
 * `\b` demands a word character on that side. A phrase that starts or ends
 * on punctuation — "the result?" ends on `?` — can never satisfy a trailing
 * `\b`, so that phrase could never match at all. The boundary is applied
 * only on the side that actually borders a word character.
 */
function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /\w/.test(phrase[0] ?? "") ? "\\b" : "";
  const right = /\w/.test(phrase[phrase.length - 1] ?? "") ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "i");
}

function checkAiTells(body: string): EditorialCheck {
  const normalised = foldApostrophes(body);
  const lower = normalised.toLowerCase();
  const hits: string[] = [];

  for (const phrase of AI_TELL_PHRASES) {
    if (phraseRegex(foldApostrophes(phrase)).test(lower)) hits.push(`"${phrase}"`);
  }
  for (const pattern of AI_TELL_PATTERNS) {
    if (pattern.regex.test(normalised)) hits.push(`${pattern.label} — ${pattern.detail}`);
  }

  return hits.length === 0
    ? ok("ai-tells", "no machine-writing tells")
    : fail("ai-tells", hits.join("; "));
}

/** True only for anchors that are themselves bare numbers ("14", "2,400,000").
 * extractAnchors also yields non-numeric anchors — quotes, proper nouns,
 * currency, dates — where a plain substring search is fine because the
 * symbol/letters around the digits already disambiguate them. */
function isNumericAnchor(anchor: string): boolean {
  return /^\d[\d,]*(?:\.\d+)?$/.test(anchor);
}

/**
 * Whether `anchor` can be traced inside `haystack`. For a bare number this
 * must be boundary-aware — mirroring anchors.ts's `isRedundantWithin` — so a
 * short number does not falsely trace against an unrelated longer one it
 * merely happens to be a digit-substring of: "3" must not trace to a source
 * that only contains "43", "1" must not trace to "100", and "2" must not
 * trace to a date like "2026-01-02".
 */
function traces(anchor: string, haystack: string): boolean {
  const needle = anchor.toLowerCase();
  if (!needle || !haystack) return false;
  if (!isNumericAnchor(anchor)) return haystack.includes(needle);

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = index > 0 ? haystack[index - 1] : "";
    const after = index + needle.length < haystack.length ? haystack[index + needle.length] : "";
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

/** Currency amounts only ("R2,400,000", "$1.2m", "€500", "£40k") — the exact
 * shape anchors.ts's own currency pattern produces. An invented figure
 * attributed to a client is the worst thing this system could publish, so
 * this is deliberately narrow.
 *
 * The `^` and `$` do the real work and are both load-bearing. Anchors are
 * not all currency-shaped tokens: extractAnchors also yields whole quoted
 * spans, so an anchor can be `we saved R500` or `R500 was the whole saving`,
 * or a name like `Robert Anderson`. Without both ends anchored, the currency
 * run inside such a span would match and the post would fail as a fabricated
 * figure. Both ends have a test pinning them.
 *
 * The `\d` is a third, weaker guard — it rejects a symbol carrying no digit
 * run at all. It is deliberately left unpinned by tests: discriminating it
 * needs an anchor like the literal quoted string `R,500`, which no realistic
 * post produces, and a contrived test would suggest coverage that means
 * nothing. It survives the mutation sweep knowingly. */
const CURRENCY_ANCHOR = /^[R$€£]\s?\d[\d,]*(?:\.\d+)?[kmb]?$/i;

/**
 * Company-indicating tokens. A multi-word, Title-Case anchor containing one
 * of these reads as a company name, not an ordinary capitalised pair —
 * exported so the list can be tuned as real posts surface tokens it misses
 * or wrongly catches.
 *
 * Every token here must be REACHABLE: this check only ever sees strings
 * extractAnchors produced, so a token that can never appear inside one
 * advertises protection that cannot fire. Reachability has TWO routes, and
 * both count:
 *
 *   1. the proper-noun pattern `[A-Z][a-z]+(\s+[A-Z][a-z]+)+`, which is
 *      Title Case only — "Kestrelmoor Capital";
 *   2. a quoted span, which is copied out verbatim and so can carry ANY
 *      token shape — `"Kestrelmoor GmbH never pays on time"`.
 *
 * Route 2 is why the all-caps entries "LLC", "PLC" and "GmbH" are live
 * rather than dead. They were briefly removed on the reasoning that route 1
 * is the only route; a fabricated client quote naming a GmbH then passed the
 * gate with nothing worse than an UNVERIFIED note. The reachability test in
 * gate.test.ts exercises both routes for exactly this reason — check it
 * against both before concluding a token is unreachable.
 */
export const COMPANY_TOKENS = [
  "Financial", "Capital", "Group", "Partners", "Holdings", "Bank", "Fund", "Funds",
  "Managers", "Management", "Asset", "Advisors", "Advisers", "Technologies", "Solutions",
  "Systems", "Services", "Consulting", "Ventures", "Ltd", "Limited", "Inc", "LLC", "PLC",
  "GmbH", "Pty",
] as const;

const COMPANY_TOKEN_SET = new Set(COMPANY_TOKENS.map((t) => t.toLowerCase()));

function isCurrencyAnchor(anchor: string): boolean {
  return CURRENCY_ANCHOR.test(anchor);
}

/**
 * A multi-word, Title-Case anchor that contains a company-indicating token
 * ("Acme Financial", "Kestrelmoor Capital Partners"). Deliberately narrow to
 * the token list: extractAnchors's multi-word-proper-noun pattern also
 * yields constant, entirely ordinary capitalised pairs from prose — "Last
 * Tuesday", "Happy Monday" — that must NOT fail this check, or good posts
 * would be rejected daily for nothing more than a capitalised day name.
 */
function isCompanyAnchor(anchor: string): boolean {
  const words = anchor.split(/\s+/);
  return words.length > 1 && words.some((w) => COMPANY_TOKEN_SET.has(w.toLowerCase()));
}

/** Untraced anchors safe to merely flag (a plain number, a rephrased
 * outcome, an ordinary proper noun) vs. ones dangerous enough to fail the
 * post outright even though some other anchor did trace: a currency figure
 * or a company-style name, either of which is a fabricated client detail if
 * it appears nowhere in the cited records. */
function isHighRisk(anchor: string): boolean {
  return isCurrencyAnchor(anchor) || isCompanyAnchor(anchor);
}

function checkSpecificity(input: GateInput): EditorialCheck {
  const anchors = extractAnchors(input.body);
  if (anchors.length === 0) {
    return fail(
      "specificity",
      "no verifiable detail — the post would still read the same with every " +
        "specific swapped out, which makes it unfalsifiable. Note that numbers " +
        'must be written as DIGITS to count: "3 days" is an anchor, "three ' +
        'days" is not. Put the exact figure, date or quoted phrase from the ' +
        "source record into the post.",
    );
  }

  const haystack = input.sourceTexts.join(" \n ").toLowerCase();
  // SourceRef.anchor is traced on the same substring/boundary basis as the
  // source text itself, NOT by exact whole-string equality: extractAnchors
  // yields the narrowest token ("14"), while a ref's own anchor may be the
  // wider phrase it was lifted from ("14 hours"). Exact equality would leave
  // this fallback permanently dead for every multi-token ref anchor.
  const refHaystack = input.sourceRefs.map((r) => r.anchor.toLowerCase()).join(" \n ");

  const traced: string[] = [];
  const untraced: string[] = [];
  for (const a of anchors) {
    (traces(a, haystack) || traces(a, refHaystack) ? traced : untraced).push(a);
  }

  // Policy: an untraced high-risk anchor (currency figure, company-style
  // name) fails the post outright, even if some other anchor did trace —
  // one verified number does not launder a fabricated client name sitting
  // next to it. Everything else untraced (plain numbers, dates, ordinary
  // proper nouns — legitimate rephrasing territory) is only flagged.
  const highRisk = untraced.filter(isHighRisk);
  if (highRisk.length > 0) {
    return fail(
      "specificity",
      `unverified client detail: ${highRisk.slice(0, 3).map((a) => `"${a}"`).join(", ")} — ` +
        "these appear nowhere in the cited records",
    );
  }

  if (traced.length === 0) {
    return fail(
      "specificity",
      `UNVERIFIED: ${untraced.slice(0, 3).join(", ")} — none of it appears in the cited ` +
        "records, so it was either invented or the wrong source is attached",
    );
  }

  const unverified =
    untraced.length > 0 ? `; UNVERIFIED: ${untraced.slice(0, 3).join(", ")}` : "";
  return ok("specificity", `anchored on ${traced.slice(0, 3).join(", ")}${unverified}`);
}

function checkBroetry(body: string): EditorialCheck {
  const paragraphs = splitParagraphs(body);
  if (paragraphs.length < 3) {
    return ok("broetry", "too short to judge paragraph rhythm");
  }
  const singles = paragraphs.filter((p) => splitSentences(p).length === 1).length;
  const ratio = singles / paragraphs.length;

  return ratio > BROETRY_THRESHOLD
    ? fail(
        "broetry",
        `${singles} of ${paragraphs.length} paragraphs are a single sentence — ` +
          "the one-line-per-thought shape reads as LinkedIn filler",
      )
    : ok("broetry", `${singles} of ${paragraphs.length} paragraphs are single-sentence`);
}

function checkOpener(body: string, recentOpeners: string[]): EditorialCheck {
  const opener = firstLine(body);
  const shape = normaliseOpener(opener);
  if (!shape) return ok("opener-collision", "no opening line to compare");

  const clash = recentOpeners.find((o) => normaliseOpener(o) === shape);
  return clash
    ? fail("opener-collision", `opens in the same shape as a recent post: "${clash}"`)
    : ok("opener-collision", "opening line is unlike the last 30");
}

function checkNeverSay(body: string, neverSay: string[]): EditorialCheck {
  const lower = body.toLowerCase();
  const hits = neverSay.filter((p) => p.trim() && lower.includes(p.toLowerCase().trim()));
  return hits.length === 0
    ? ok("never-say", "avoids everything on your never-say list")
    : fail("never-say", `uses ${hits.map((h) => `"${h}"`).join(", ")}, which you have killed before`);
}

function checkBurstiness(body: string, profile: VoiceStats): EditorialCheck {
  const stats = measure(body);

  // Two independent fail conditions, either one is enough (a logical OR):
  // relative to the founder's own baseline (compare(), profile-relative,
  // dead when profile.burstiness <= 0.15), and the absolute floor below
  // which rhythm reads as machine-uniform regardless of whose baseline it
  // is judged against (BURSTINESS_FLOOR, catches the cold-start / low-
  // baseline case the relative check cannot).
  const relativeDrift = compare(stats, profile).find((d) => d.metric === "burstiness");
  if (relativeDrift) {
    return fail("burstiness", relativeDrift.detail);
  }
  if (stats.burstiness < BURSTINESS_FLOOR) {
    return fail(
      "burstiness",
      `sentence rhythm is uniform (${stats.burstiness.toFixed(2)}), under the ` +
        `${BURSTINESS_FLOOR.toFixed(2)} floor regardless of your own baseline ` +
        `(${profile.burstiness.toFixed(2)}) — vary the lengths, land a short one`,
    );
  }
  return ok(
    "burstiness",
    `rhythm ${stats.burstiness.toFixed(2)} against your ${profile.burstiness.toFixed(2)}`,
  );
}

export function runGate(input: GateInput): EditorialCheck[] {
  return [
    checkAiTells(input.body),
    checkSpecificity(input),
    checkBroetry(input.body),
    checkOpener(input.body, input.recentOpeners),
    checkNeverSay(input.body, input.neverSay),
    checkBurstiness(input.body, input.profile),
  ];
}
