"use client";

import { useState } from "react";
import { Plus, Sparkles, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select } from "@/components/ui/Field";
import type { GlossaryCard, OfferingCard, PronunciationCard } from "@/lib/types";
import type { PlaybookSections, StageId } from "@/lib/prep/session";
import { uid } from "@/lib/utils";

type Section = keyof PlaybookSections; // "pronunciations" | "glossary" | "offerings"
type AnyCard = PronunciationCard | GlossaryCard | OfferingCard;

const STAGE_OF: Record<Section, StageId> = {
  pronunciations: "pronunciation",
  glossary: "glossary",
  offerings: "offerings",
};

export function PlaybookEditor({
  sections,
  onChange,
  onDraft,
  drafting,
}: {
  sections: PlaybookSections;
  /** Replace one section's full card list. */
  onChange: (section: Section, cards: AnyCard[]) => void;
  /** Ask the AI to draft this section; resolves to the drafted cards for that section. */
  onDraft: (stage: StageId) => Promise<AnyCard[]>;
  drafting: Section | null;
}) {
  const [editing, setEditing] = useState<{ section: Section; card: AnyCard } | null>(null);

  const blank = (section: Section): AnyCard => {
    if (section === "pronunciations") return { id: uid("pron"), confidence: "new", term: "", phonetic: "", tip: "" };
    if (section === "glossary") return { id: uid("gloss"), confidence: "new", term: "", definition: "", kind: "term", industry: "", example: "" };
    return { id: uid("offer"), confidence: "new", name: "", summary: "", valueProp: "", priceAnchor: "", objection: "", response: "" };
  };

  const upsert = (section: Section, card: AnyCard) => {
    const list = sections[section] as AnyCard[];
    const exists = list.some((c) => c.id === card.id);
    onChange(section, exists ? list.map((c) => (c.id === card.id ? card : c)) : [card, ...list]);
  };

  const remove = (section: Section, id: string) => {
    onChange(section, (sections[section] as AnyCard[]).filter((c) => c.id !== id));
  };

  const draftInto = async (section: Section) => {
    const drafted = await onDraft(STAGE_OF[section]);
    if (drafted.length) onChange(section, [...drafted, ...(sections[section] as AnyCard[])]);
  };

  const titleOf = (section: Section, card: AnyCard) =>
    section === "offerings" ? (card as OfferingCard).name : (card as PronunciationCard | GlossaryCard).term;

  const subtitleOf = (section: Section, card: AnyCard) => {
    if (section === "pronunciations") return (card as PronunciationCard).phonetic;
    if (section === "glossary") return (card as GlossaryCard).definition;
    return (card as OfferingCard).valueProp;
  };

  const sectionMeta: { key: Section; title: string }[] = [
    { key: "pronunciations", title: "Pronunciation" },
    { key: "glossary", title: "Business & Industry" },
    { key: "offerings", title: "Tools & Values" },
  ];

  return (
    <div className="space-y-5">
      {sectionMeta.map(({ key, title }) => {
        const list = sections[key] as AnyCard[];
        return (
          <Panel
            key={key}
            title={title}
            action={
              <div className="flex items-center gap-2">
                <button className="btn btn-sm" onClick={() => void draftInto(key)} disabled={drafting === key}>
                  {drafting === key ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with AI
                </button>
                <button className="btn btn-sm" onClick={() => setEditing({ section: key, card: blank(key) })}>
                  <Plus size={13} /> Add
                </button>
              </div>
            }
          >
            {list.length === 0 ? (
              <p className="text-[0.82rem] text-[var(--color-dim)] py-2">No cards yet — add one or draft with AI.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {list.map((card) => (
                  <li key={card.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-medium text-[var(--color-ink)] truncate">{titleOf(key, card) || "(untitled)"}</div>
                      <div className="text-[0.78rem] text-[var(--color-muted)] truncate">{subtitleOf(key, card)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button className="btn btn-ghost btn-icon" title="Edit" onClick={() => setEditing({ section: key, card })}><Pencil size={14} /></button>
                      <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => remove(key, card.id)}><Trash2 size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}

      {editing && (
        <CardEditModal
          section={editing.section}
          card={editing.card}
          onClose={() => setEditing(null)}
          onSave={(card) => { upsert(editing.section, card); setEditing(null); }}
        />
      )}
    </div>
  );
}

function CardEditModal({
  section, card, onClose, onSave,
}: {
  section: Section;
  card: AnyCard;
  onClose: () => void;
  onSave: (card: AnyCard) => void;
}) {
  const [draft, setDraft] = useState<AnyCard>(card);
  const set = (patch: Partial<AnyCard>) => setDraft((d) => ({ ...d, ...patch } as AnyCard));

  return (
    <Modal open title="Edit card" onClose={onClose}>
      <div className="space-y-3.5">
        {section === "pronunciations" && (() => {
          const c = draft as PronunciationCard;
          return (
            <>
              <Field label="Term"><TextInput value={c.term} onChange={(e) => set({ term: e.target.value })} /></Field>
              <Field label="Phonetic respelling" hint="e.g. ee-BIT-da"><TextInput value={c.phonetic} onChange={(e) => set({ phonetic: e.target.value })} /></Field>
              <Field label="Tip"><TextInput value={c.tip} onChange={(e) => set({ tip: e.target.value })} /></Field>
            </>
          );
        })()}

        {section === "glossary" && (() => {
          const c = draft as GlossaryCard;
          return (
            <>
              <Field label="Term"><TextInput value={c.term} onChange={(e) => set({ term: e.target.value })} /></Field>
              <Field label="Kind"><Select options={["term", "acronym"]} value={c.kind} onChange={(e) => set({ kind: e.target.value as GlossaryCard["kind"] })} /></Field>
              <Field label="Definition"><TextArea value={c.definition} onChange={(e) => set({ definition: e.target.value })} /></Field>
              <Field label="Example sentence"><TextInput value={c.example} onChange={(e) => set({ example: e.target.value })} /></Field>
              <Field label="Industry" hint="leave blank for general"><TextInput value={c.industry} onChange={(e) => set({ industry: e.target.value })} /></Field>
            </>
          );
        })()}

        {section === "offerings" && (() => {
          const c = draft as OfferingCard;
          return (
            <>
              <Field label="Name"><TextInput value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Summary"><TextArea value={c.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
              <Field label="Value prop"><TextArea value={c.valueProp} onChange={(e) => set({ valueProp: e.target.value })} /></Field>
              <Field label="Price anchor"><TextInput value={c.priceAnchor} onChange={(e) => set({ priceAnchor: e.target.value })} /></Field>
              <Field label="Likely objection"><TextInput value={c.objection} onChange={(e) => set({ objection: e.target.value })} /></Field>
              <Field label="Response"><TextArea value={c.response} onChange={(e) => set({ response: e.target.value })} /></Field>
            </>
          );
        })()}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={() => onSave(draft)}><Check size={15} /> Save</button>
        </div>
      </div>
    </Modal>
  );
}
