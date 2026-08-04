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

  it("pulls currency in $, £ and € as well as R, and ignores an embedded false positive", () => {
    expect(extractAnchors("We closed $1.2m last quarter.")).toContain("$1.2m");
    expect(extractAnchors("The contract was £40k.")).toContain("£40k");
    expect(extractAnchors("It cost €500.")).toContain("€500");
    expect(extractAnchors("Saving R120,000.")).toContain("R120,000");
    const noAnchor = extractAnchors("Model AR500 shipped.");
    expect(noAnchor).not.toContain("R500");
    expect(noAnchor.some((a) => a.includes("R500"))).toBe(false);
  });

  it("keeps a shorter number distinct from a longer one that merely contains its digits", () => {
    const a = extractAnchors("14 clients signed, 114 total.");
    expect(a).toContain("14");
    expect(a).toContain("114");

    const b = extractAnchors("2 renewed out of 20 contacted.");
    expect(b).toContain("2");
    expect(b).toContain("20");
  });
});
