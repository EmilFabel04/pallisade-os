import { describe, it, expect } from "vitest";
import {
  orderCards,
  nextConfidence,
  buildSession,
  mergeCards,
  mergePlaybook,
} from "./session";
import type { GlossaryCard, OfferingCard, Playbook, PronunciationCard } from "@/lib/types";

const glossary = (id: string, term: string, confidence: GlossaryCard["confidence"]): GlossaryCard => ({
  id, term, confidence, definition: "d", kind: "term", industry: "", example: "e",
});

describe("orderCards", () => {
  it("orders learning first, then new, then known (stable within a group)", () => {
    const cards = [
      glossary("a", "A", "known"),
      glossary("b", "B", "new"),
      glossary("c", "C", "learning"),
      glossary("d", "D", "new"),
    ];
    expect(orderCards(cards).map((c) => c.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("does not mutate the input array", () => {
    const cards = [glossary("a", "A", "known"), glossary("c", "C", "learning")];
    orderCards(cards);
    expect(cards.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("nextConfidence", () => {
  it("promotes to known on a correct recall", () => {
    expect(nextConfidence(false)).toBe("learning");
    expect(nextConfidence(true)).toBe("known");
  });
});

describe("buildSession", () => {
  const pron: PronunciationCard = { id: "p1", confidence: "new", term: "X", phonetic: "ex", tip: "t" };
  const off: OfferingCard = {
    id: "o1", confidence: "new", name: "Bot", summary: "s", valueProp: "v",
    priceAnchor: "", objection: "too dear", response: "worth it",
  };

  it("builds three ordered stages and tags their kind", () => {
    const pb: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [pron], glossary: [glossary("g1", "AUM", "new")], offerings: [off],
    };
    const stages = buildSession(pb);
    expect(stages.map((s) => s.id)).toEqual(["pronunciation", "glossary", "offerings"]);
    expect(stages[0].kind).toBe("pronunciation");
    expect(stages[1].kind).toBe("recall");
    expect(stages[2].kind).toBe("recall");
  });

  it("auto-skips stages with no cards", () => {
    const pb: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [], glossary: [glossary("g1", "AUM", "new")], offerings: [],
    };
    expect(buildSession(pb).map((s) => s.id)).toEqual(["glossary"]);
  });
});

describe("mergeCards", () => {
  it("appends additions but drops ones whose key already exists (case-insensitive), base wins", () => {
    const base = [glossary("g1", "AUM", "known")];
    const additions = [glossary("g2", "aum", "new"), glossary("g3", "Mandate", "new")];
    const merged = mergeCards(base, additions, (c) => c.term);
    expect(merged.map((c) => c.id)).toEqual(["g1", "g3"]); // "aum" dropped, base "g1" kept
  });
});

describe("mergePlaybook", () => {
  it("merges every section by its natural key", () => {
    const base: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [{ id: "p1", confidence: "new", term: "X", phonetic: "", tip: "" }],
      glossary: [glossary("g1", "AUM", "new")],
      offerings: [],
    };
    const additions = {
      pronunciations: [{ id: "p2", confidence: "new" as const, term: "Y", phonetic: "", tip: "" }],
      glossary: [glossary("g2", "AUM", "new")], // dup → dropped
      offerings: [{
        id: "o2", confidence: "new" as const, name: "Bot", summary: "", valueProp: "",
        priceAnchor: "", objection: "", response: "",
      }],
    };
    const merged = mergePlaybook(base, additions);
    expect(merged.pronunciations.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(merged.glossary.map((c) => c.id)).toEqual(["g1"]);
    expect(merged.offerings.map((c) => c.id)).toEqual(["o2"]);
  });
});
