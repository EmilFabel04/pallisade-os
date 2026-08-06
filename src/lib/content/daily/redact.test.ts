import { describe, it, expect } from "vitest";
import { buildVocabulary, redactText, REDACTED_ORG, REDACTED_PERSON } from "./redact";
import type { DataShape } from "@/lib/types";

/** Only the fields the vocabulary actually reads. */
const data = {
  leads: [
    { id: "l1", company: "Kestrelmoor Capital", contactName: "Sarah Whitfield" },
    { id: "l2", company: "Brackenfold Holdings", contactName: "Tom Bex" },
  ],
  interactions: [{ id: "i1", company: "Lanternpost Partners", contact: "James Okoro" }],
  projects: [{ id: "p1", company: "Kestrelmoor Capital" }],
} as unknown as DataShape;

describe("buildVocabulary", () => {
  it("collects company and person names from every record that carries one", () => {
    const v = buildVocabulary(data);
    expect(v.organisations).toEqual(
      expect.arrayContaining(["Kestrelmoor Capital", "Brackenfold Holdings", "Lanternpost Partners"]),
    );
    expect(v.people).toEqual(expect.arrayContaining(["Sarah Whitfield", "James Okoro"]));
  });

  it("deduplicates a company that appears in more than one collection", () => {
    // Kestrelmoor Capital is on both a lead and a project.
    const orgs = buildVocabulary(data).organisations.filter((o) => o === "Kestrelmoor Capital");
    expect(orgs).toHaveLength(1);
  });

  it("ignores blank and whitespace-only names rather than emitting empty entries", () => {
    // An empty vocabulary entry would turn into a regex matching everywhere and
    // redact the entire post to placeholders.
    const v = buildVocabulary({
      leads: [{ id: "l1", company: "  ", contactName: "" }],
    } as unknown as DataShape);
    expect(v.organisations).toHaveLength(0);
    expect(v.people).toHaveLength(0);
  });

  it("survives collections being absent entirely", () => {
    expect(() => buildVocabulary({} as DataShape)).not.toThrow();
  });
});

describe("redactText", () => {
  const vocab = buildVocabulary(data);

  it("replaces a company name with the neutral placeholder", () => {
    const out = redactText("Kestrelmoor Capital still reconciles by hand.", vocab);
    expect(out).not.toContain("Kestrelmoor Capital");
    expect(out).toContain(REDACTED_ORG);
  });

  it("replaces a contact name with the neutral placeholder", () => {
    const out = redactText("Sarah Whitfield said it takes 14 hours.", vocab);
    expect(out).not.toContain("Sarah Whitfield");
    expect(out).toContain(REDACTED_PERSON);
  });

  it("matches regardless of case", () => {
    expect(redactText("kestrelmoor capital called", vocab)).not.toMatch(/kestrelmoor/i);
  });

  it("redacts a bare surname as well as the full name", () => {
    // Notes rarely repeat the full name: "Spoke to Sarah again" is the norm,
    // and leaving the given name behind defeats the whole guarantee.
    const out = redactText("Spoke to Sarah again, still stuck on the same thing.", vocab);
    expect(out).not.toMatch(/\bSarah\b/);
  });

  it("does not redact a short first name that is also an ordinary word", () => {
    // "Tom Bex" contributes "Tom" and "Bex"; a two-letter fragment or a common
    // word would shred unrelated prose. Guard against over-redaction.
    const out = redactText("The bill was sent on time.", vocab);
    expect(out).toBe("The bill was sent on time.");
  });

  it("keeps the numbers that carry the post's anchor", () => {
    // Redaction must not cost the post its traceable detail.
    const out = redactText("Kestrelmoor Capital loses 14 hours a month.", vocab);
    expect(out).toContain("14 hours");
  });

  it("leaves text untouched when the vocabulary is empty", () => {
    const empty = buildVocabulary({} as DataShape);
    expect(redactText("Nothing to hide here.", empty)).toBe("Nothing to hide here.");
  });

  it("handles a name containing regex metacharacters without throwing", () => {
    const v = buildVocabulary({
      leads: [{ id: "l1", company: "C++ (Pty) Ltd", contactName: "" }],
    } as unknown as DataShape);
    expect(() => redactText("C++ (Pty) Ltd called", v)).not.toThrow();
    expect(redactText("C++ (Pty) Ltd called", v)).not.toContain("C++");
  });
});
