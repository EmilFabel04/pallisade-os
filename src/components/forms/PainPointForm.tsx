"use client";

import { useState } from "react";
import { URGENCIES, type PainPoint } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, NumberInput, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "./FormActions";

type Draft = Omit<PainPoint, "id" | "createdAt" | "updatedAt">;

export function PainPointForm({ initial, onClose }: { initial?: PainPoint; onClose: () => void }) {
  const { create, update } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    painPoint: initial?.painPoint ?? "",
    industry: initial?.industry ?? "",
    companyType: initial?.companyType ?? "",
    whoMentioned: initial?.whoMentioned ?? "",
    frequency: initial?.frequency ?? 1,
    workaround: initial?.workaround ?? "",
    possibleSolution: initial?.possibleSolution ?? "",
    urgency: initial?.urgency ?? "medium",
    willingnessToPay: initial?.willingnessToPay ?? "medium",
    notes: initial?.notes ?? "",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.painPoint.trim()) return;
    if (initial) update("painPoints", initial.id, d);
    else create("painPoints", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Pain point *">
        <TextInput value={d.painPoint} onChange={(e) => set("painPoint", e.target.value)} autoFocus required placeholder="What's the repeated problem?" />
      </Field>

      <FormGrid>
        <Field label="Industry" className="mt-3.5">
          <TextInput value={d.industry} onChange={(e) => set("industry", e.target.value)} />
        </Field>
        <Field label="Company type" className="mt-3.5">
          <TextInput value={d.companyType} onChange={(e) => set("companyType", e.target.value)} />
        </Field>
        <Field label="Who mentioned it">
          <TextInput value={d.whoMentioned} onChange={(e) => set("whoMentioned", e.target.value)} placeholder="Companies / people" />
        </Field>
        <Field label="Frequency (mentions)">
          <NumberInput min={1} value={d.frequency} onChange={(e) => set("frequency", Number(e.target.value))} />
        </Field>
        <Field label="Urgency">
          <Select options={URGENCIES} value={d.urgency} onChange={(e) => set("urgency", e.target.value as Draft["urgency"])} />
        </Field>
        <Field label="Willingness to pay">
          <Select options={URGENCIES} value={d.willingnessToPay} onChange={(e) => set("willingnessToPay", e.target.value as Draft["willingnessToPay"])} />
        </Field>
      </FormGrid>

      <Field label="Current workaround" className="mt-3.5">
        <TextArea value={d.workaround} onChange={(e) => set("workaround", e.target.value)} rows={2} />
      </Field>
      <Field label="Possible solution" className="mt-3.5">
        <TextArea value={d.possibleSolution} onChange={(e) => set("possibleSolution", e.target.value)} rows={2} />
      </Field>
      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Add pain point"} saveDisabled={!d.painPoint.trim()} />
    </form>
  );
}
