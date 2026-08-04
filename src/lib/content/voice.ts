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
      (countMatches(text, /\b\w+[''](?:t|s|re|ve|ll|d|m)\b/gi) /
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
