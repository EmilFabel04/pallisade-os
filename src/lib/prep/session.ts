import type {
  Confidence,
  GlossaryCard,
  OfferingCard,
  Playbook,
  PlaybookCard,
  PronunciationCard,
} from "@/lib/types";

export type StageId = "pronunciation" | "glossary" | "offerings";

export interface BuiltStage {
  id: StageId;
  title: string;
  kind: "pronunciation" | "recall";
  cards: PlaybookCard[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { learning: 0, new: 1, known: 2 };

/** Learning cards first (need most work), then unseen, then known. Stable, non-mutating. */
export function orderCards<T extends PlaybookCard>(cards: T[]): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const byRank = CONFIDENCE_RANK[a.card.confidence] - CONFIDENCE_RANK[b.card.confidence];
      return byRank !== 0 ? byRank : a.index - b.index;
    })
    .map((x) => x.card);
}

/** Self-graded transition: one clean pass marks a card known; a miss sends it to learning. */
export function nextConfidence(gotIt: boolean): Confidence {
  return gotIt ? "known" : "learning";
}

/** Assemble the three ordered stages, skipping any with no cards. */
export function buildSession(playbook: Playbook): BuiltStage[] {
  const stages: BuiltStage[] = [
    { id: "pronunciation", title: "Pronunciation", kind: "pronunciation", cards: orderCards(playbook.pronunciations) },
    { id: "glossary", title: "Business & Industry", kind: "recall", cards: orderCards(playbook.glossary) },
    { id: "offerings", title: "Tools & Values", kind: "recall", cards: orderCards(playbook.offerings) },
  ];
  return stages.filter((s) => s.cards.length > 0);
}

/** Append additions, dropping any whose key already exists in base (case-insensitive). Base wins. */
export function mergeCards<T extends PlaybookCard>(
  base: T[],
  additions: T[],
  keyOf: (card: T) => string,
): T[] {
  const seen = new Set(base.map((c) => keyOf(c).trim().toLowerCase()));
  const extra = additions.filter((c) => {
    const key = keyOf(c).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...base, ...extra];
}

export interface PlaybookSections {
  pronunciations: PronunciationCard[];
  glossary: GlossaryCard[];
  offerings: OfferingCard[];
}

/** Layer meeting-specific cards onto a saved playbook for one session (no overwrite). */
export function mergePlaybook(base: Playbook, additions: PlaybookSections): Playbook {
  return {
    ...base,
    pronunciations: mergeCards(base.pronunciations, additions.pronunciations, (c) => c.term),
    glossary: mergeCards(base.glossary, additions.glossary, (c) => c.term),
    offerings: mergeCards(base.offerings, additions.offerings, (c) => c.name),
  };
}
