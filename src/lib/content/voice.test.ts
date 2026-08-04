import { describe, it, expect } from "vitest";
import { splitSentences, splitParagraphs, measure } from "./voice";

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("treats a newline as a sentence boundary (LinkedIn posts often drop full stops)", () => {
    expect(splitSentences("No full stop here\nSecond line")).toEqual([
      "No full stop here",
      "Second line",
    ]);
  });

  it("ignores empty fragments from trailing punctuation and blank lines", () => {
    expect(splitSentences("Done.\n\n\n")).toEqual(["Done."]);
  });
});

describe("splitParagraphs", () => {
  it("splits on any run of newlines, so broetry counts as many paragraphs", () => {
    expect(splitParagraphs("A.\n\nB.\nC.")).toEqual(["A.", "B.", "C."]);
  });
});

describe("measure", () => {
  it("returns zero burstiness when every sentence is the same length", () => {
    const text = "aa bb cc dd. aa bb cc dd. aa bb cc dd. aa bb cc dd.";
    expect(measure(text).burstiness).toBe(0);
  });

  it("computes burstiness as population stddev over mean", () => {
    // Sentence word counts: 2 and 18. mean 10, stddev 8 => 0.8
    const short = "aa bb.";
    const long = Array.from({ length: 18 }, (_, i) => `w${i}`).join(" ") + ".";
    expect(measure(`${short} ${long}`).burstiness).toBeCloseTo(0.8, 5);
  });

  it("counts short sentences as those under eight words", () => {
    // 3 words, 3 words, 9 words => 2/3 short
    const text = "one two three. four five six. a b c d e f g h i.";
    expect(measure(text).shortSentenceRatio).toBeCloseTo(2 / 3, 5);
  });

  it("counts contractions per hundred words, straight and curly apostrophes", () => {
    const words = Array.from({ length: 96 }, (_, i) => `w${i}`).join(" ");
    // 4 contractions in 100 words => 4
    const text = `don't can't it's we're ${words}.`;
    expect(measure(text).contractionRate).toBeCloseTo(4, 5);
  });

  it("counts questions per hundred sentences", () => {
    expect(measure("A. B? C. D?").questionRate).toBeCloseTo(50, 5);
  });

  it("counts emoji", () => {
    expect(measure("Shipping today 🚀🔥").emojiPerPost).toBe(2);
  });

  it("counts first-person pronouns per hundred words", () => {
    const words = Array.from({ length: 98 }, (_, i) => `w${i}`).join(" ");
    expect(measure(`I my ${words}.`).firstPersonRate).toBeCloseTo(2, 5);
  });

  it("returns all-zero stats for empty input rather than NaN", () => {
    const s = measure("   ");
    expect(s.burstiness).toBe(0);
    expect(s.avgSentenceLength).toBe(0);
    expect(Number.isNaN(s.contractionRate)).toBe(false);
  });
});
