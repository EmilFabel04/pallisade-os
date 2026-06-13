"use client";

import { useState } from "react";
import { INTERACTION_TYPES, type Interaction } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, Select, TextArea, TextInput } from "@/components/ui/Field";
import { DictateTextArea } from "@/components/ui/DictateTextArea";
import { todayISO } from "@/lib/utils";
import { FormActions } from "./FormActions";

type Draft = Omit<Interaction, "id" | "createdAt" | "updatedAt" | "summary">;

export function InteractionForm({
  initial,
  presetLeadId,
  onClose,
}: {
  initial?: Interaction;
  presetLeadId?: string;
  onClose: () => void;
}) {
  const { create, update, leads } = useStore();
  const presetLead = leads.find((l) => l.id === (initial?.leadId ?? presetLeadId));

  const [d, setD] = useState<Draft>(() => ({
    leadId: initial?.leadId ?? presetLeadId ?? null,
    company: initial?.company ?? presetLead?.company ?? "",
    contact: initial?.contact ?? presetLead?.contactName ?? "",
    date: initial?.date ?? todayISO(),
    type: initial?.type ?? "cold call",
    rawNotes: initial?.rawNotes ?? "",
    whatTheySaid: initial?.whatTheySaid ?? "",
    painPoints: initial?.painPoints ?? "",
    objections: initial?.objections ?? "",
    buyingSignals: initial?.buyingSignals ?? "",
    followUpRequired: initial?.followUpRequired ?? false,
    followUpDate: initial?.followUpDate ?? null,
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const onLeadChange = (id: string) => {
    const lead = leads.find((l) => l.id === id);
    setD((p) => ({
      ...p,
      leadId: id || null,
      company: lead?.company ?? p.company,
      contact: lead?.contactName ?? p.contact,
    }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.company.trim()) return;
    if (initial) update("interactions", initial.id, d);
    else create("interactions", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <FormGrid>
        <Field label="Linked lead">
          <select className="select" value={d.leadId ?? ""} onChange={(e) => onLeadChange(e.target.value)}>
            <option value="">— None / ad-hoc —</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.company} · {l.contactName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Interaction type">
          <Select options={INTERACTION_TYPES} value={d.type} onChange={(e) => set("type", e.target.value as Draft["type"])} />
        </Field>
        <Field label="Company *">
          <TextInput value={d.company} onChange={(e) => set("company", e.target.value)} required />
        </Field>
        <Field label="Contact">
          <TextInput value={d.contact} onChange={(e) => set("contact", e.target.value)} />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={d.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Follow-up date">
          <TextInput type="date" value={d.followUpDate ?? ""} onChange={(e) => set("followUpDate", e.target.value || null)} />
        </Field>
      </FormGrid>

      <Field label="Raw notes" className="mt-3.5" hint="Rough notes — the AI summary turns these into structured output.">
        <DictateTextArea value={d.rawNotes} onValueChange={(v) => set("rawNotes", v)} rows={4} autoFocus placeholder="Dump everything from the conversation here… or 🎙 to dictate" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 mt-3.5">
        <Field label="What they said">
          <TextArea value={d.whatTheySaid} onChange={(e) => set("whatTheySaid", e.target.value)} rows={2} />
        </Field>
        <Field label="Pain points mentioned">
          <TextArea value={d.painPoints} onChange={(e) => set("painPoints", e.target.value)} rows={2} />
        </Field>
        <Field label="Objections">
          <TextArea value={d.objections} onChange={(e) => set("objections", e.target.value)} rows={2} />
        </Field>
        <Field label="Buying signals">
          <TextArea value={d.buyingSignals} onChange={(e) => set("buyingSignals", e.target.value)} rows={2} />
        </Field>
      </div>

      <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={d.followUpRequired}
          onChange={(e) => set("followUpRequired", e.target.checked)}
          style={{ accentColor: "var(--color-accent)", width: 15, height: 15 }}
        />
        <span className="text-[0.83rem] text-[var(--color-ink-soft)]">Follow-up required</span>
      </label>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Log interaction"} saveDisabled={!d.company.trim()} />
    </form>
  );
}
