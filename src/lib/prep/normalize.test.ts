import { describe, it, expect } from "vitest";
import { normalizeDraft } from "./normalize";

describe("normalizeDraft", () => {
  it("returns three arrays even from empty / missing input", () => {
    const out = normalizeDraft({});
    expect(out).toEqual({ pronunciations: [], glossary: [], offerings: [] });
  });

  it("ignores non-array sections and non-object items", () => {
    const out = normalizeDraft({ glossary: "nope", offerings: [1, null, "x"], pronunciations: undefined });
    expect(out.glossary).toEqual([]);
    expect(out.offerings).toEqual([]);
  });

  it("defaults confidence to new, fills missing strings, and assigns a non-empty id", () => {
    const out = normalizeDraft({
      pronunciations: [{ term: "EBITDA", phonetic: "ee-BIT-da" }],
      glossary: [{ term: "AUM", definition: "assets under management", kind: "acronym" }],
      offerings: [{ name: "Reporting bot" }],
    });

    expect(out.pronunciations[0]).toMatchObject({
      term: "EBITDA", phonetic: "ee-BIT-da", tip: "", confidence: "new",
    });
    expect(out.pronunciations[0].id.length).toBeGreaterThan(0);

    expect(out.glossary[0]).toMatchObject({
      term: "AUM", definition: "assets under management", kind: "acronym", industry: "", example: "", confidence: "new",
    });

    expect(out.offerings[0]).toMatchObject({
      name: "Reporting bot", summary: "", valueProp: "", priceAnchor: "", objection: "", response: "", confidence: "new",
    });
  });

  it("coerces an invalid glossary kind to 'term'", () => {
    const out = normalizeDraft({ glossary: [{ term: "x", kind: "banana" }] });
    expect(out.glossary[0].kind).toBe("term");
  });
});
