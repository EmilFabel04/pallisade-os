import { describe, it, expect } from "vitest";
import { extractAnchors } from "./anchors";

describe("extractAnchors", () => {
  it("pulls plain numbers, percentages and currency", () => {
    const a = extractAnchors("Cut it from 14 hours to 2, a 47% drop, saving R120,000.");
    expect(a).toContain("14");
    expect(a).toContain("47%");
    expect(a).toContain("R120,000");
  });

  it("pulls ISO and written dates", () => {
    const a = extractAnchors("On 2026-07-14 and again on 12 June we saw it.");
    expect(a).toContain("2026-07-14");
    expect(a).toContain("12 June");
  });

  it("pulls multi-word proper nouns", () => {
    expect(extractAnchors("Spoke to Kloofwind Fund Managers again.")).toContain(
      "Kloofwind Fund Managers",
    );
  });

  it("pulls quoted spans, straight and curly", () => {
    const a = extractAnchors('He said "we rebuild it every month" and “nobody owns it”.');
    expect(a).toContain("we rebuild it every month");
    expect(a).toContain("nobody owns it");
  });

  it("ignores a single capitalised word at the start of a sentence", () => {
    expect(extractAnchors("Reconciliation is slow.")).toEqual([]);
  });

  it("deduplicates and returns an empty array for anchor-free text", () => {
    expect(extractAnchors("it takes ages and everyone hates it")).toEqual([]);
    expect(extractAnchors("47% and 47%")).toEqual(["47%"]);
  });
});
