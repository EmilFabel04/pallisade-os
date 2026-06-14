import type { GlossaryCard, OfferingCard, PronunciationCard } from "@/lib/types";
import type { PlaybookSections } from "./session";
import { uid } from "@/lib/utils";

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function objects(v: unknown): Raw[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Raw => !!x && typeof x === "object");
}

function pronunciation(r: Raw): PronunciationCard {
  return { id: uid("pron"), confidence: "new", term: str(r.term), phonetic: str(r.phonetic), tip: str(r.tip) };
}

function glossary(r: Raw): GlossaryCard {
  return {
    id: uid("gloss"),
    confidence: "new",
    term: str(r.term),
    definition: str(r.definition),
    kind: r.kind === "acronym" ? "acronym" : "term",
    industry: str(r.industry),
    example: str(r.example),
  };
}

function offering(r: Raw): OfferingCard {
  return {
    id: uid("offer"),
    confidence: "new",
    name: str(r.name),
    summary: str(r.summary),
    valueProp: str(r.valueProp),
    priceAnchor: str(r.priceAnchor),
    objection: str(r.objection),
    response: str(r.response),
  };
}

/** Coerce untrusted model output into typed, defaulted card arrays. */
export function normalizeDraft(raw: Raw): PlaybookSections {
  return {
    pronunciations: objects(raw.pronunciations).map(pronunciation),
    glossary: objects(raw.glossary).map(glossary),
    offerings: objects(raw.offerings).map(offering),
  };
}
