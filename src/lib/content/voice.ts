/* ============================================================
   Voice measurement — pure, no model calls.

   The same functions run over the founder's writing samples and
   over every generated draft, which is what makes "sounds like
   him" a measurable claim rather than a hope.
   ============================================================ */

export interface VoiceStats {
  /** stddev / mean of sentence word-counts. Low = machine-uniform. */
  burstiness: number;
  avgSentenceLength: number;
  /** Share (0-1) of sentences under 8 words. */
  shortSentenceRatio: number;
  /** Contractions per 100 words. */
  contractionRate: number;
  /** Questions per 100 sentences. */
  questionRate: number;
  avgParagraphSentences: number;
  emojiPerPost: number;
  /** I/my/me/we/our/us per 100 words. */
  firstPersonRate: number;
}

export const ZERO_STATS: VoiceStats = {
  burstiness: 0,
  avgSentenceLength: 0,
  shortSentenceRatio: 0,
  contractionRate: 0,
  questionRate: 0,
  avgParagraphSentences: 0,
  emojiPerPost: 0,
  firstPersonRate: 0,
};

/** A newline ends a sentence too — LinkedIn posts routinely drop full stops. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[A-Za-z0-9]/.test(s));
}

/** Any run of newlines starts a new paragraph, so broetry reads as many. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function measure(text: string): VoiceStats {
  const sentences = splitSentences(text);
  const allWords = words(text);
  if (sentences.length === 0 || allWords.length === 0) return { ...ZERO_STATS };

  const lengths = sentences.map((s) => words(s).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);

  const paragraphs = splitParagraphs(text);

  return {
    burstiness: mean === 0 ? 0 : stddev / mean,
    avgSentenceLength: mean,
    shortSentenceRatio: lengths.filter((n) => n < 8).length / lengths.length,
    contractionRate:
      (countMatches(text, /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi) /
        allWords.length) *
      100,
    questionRate:
      (sentences.filter((s) => s.endsWith("?")).length / sentences.length) * 100,
    avgParagraphSentences:
      paragraphs.length === 0 ? 0 : sentences.length / paragraphs.length,
    emojiPerPost: countMatches(text, /\p{Extended_Pictographic}/gu),
    firstPersonRate:
      (countMatches(text, /\b(?:I|my|me|we|our|us)\b/gi) / allWords.length) * 100,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const STAT_KEYS = Object.keys(ZERO_STATS) as (keyof VoiceStats)[];

/** Median across samples — one weird sample must not define the voice. */
export function profileFromSamples(samples: string[]): VoiceStats {
  const measured = samples.map(measure);
  if (measured.length === 0) return { ...ZERO_STATS };
  const out = { ...ZERO_STATS };
  for (const key of STAT_KEYS) {
    out[key] = median(measured.map((m) => m[key]));
  }
  return out;
}

export interface Deviation {
  metric: keyof VoiceStats;
  draft: number;
  profile: number;
  detail: string;
}

/** Relative tolerance per metric, as a fraction of the profile value. */
const TOLERANCE: Partial<Record<keyof VoiceStats, number>> = {
  avgSentenceLength: 0.4,
  shortSentenceRatio: 0.5,
  contractionRate: 0.6,
  avgParagraphSentences: 0.5,
};

/** Absolute floor below the profile's burstiness before we complain. */
const BURSTINESS_SLACK = 0.15;

export function compare(draft: VoiceStats, profile: VoiceStats): Deviation[] {
  const out: Deviation[] = [];

  // One-sided: more variety than usual is never a fault, less always is.
  if (draft.burstiness < profile.burstiness - BURSTINESS_SLACK) {
    out.push({
      metric: "burstiness",
      draft: draft.burstiness,
      profile: profile.burstiness,
      detail:
        `sentence rhythm is uniform (${draft.burstiness.toFixed(2)} against your ` +
        `${profile.burstiness.toFixed(2)}) — vary the lengths, land a short one`,
    });
  }

  for (const [metric, tolerance] of Object.entries(TOLERANCE) as [
    keyof VoiceStats,
    number,
  ][]) {
    const p = profile[metric];
    if (p === 0) continue;
    const drift = Math.abs(draft[metric] - p) / p;
    if (drift > tolerance) {
      out.push({
        metric,
        draft: draft[metric],
        profile: p,
        detail:
          `${metric} is ${draft[metric].toFixed(1)} against your ${p.toFixed(1)}`,
      });
    }
  }

  return out;
}
