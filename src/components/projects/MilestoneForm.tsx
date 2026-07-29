"use client";

import { useState } from "react";
import { MILESTONE_STATUSES, type Milestone } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, NumberInput, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "@/components/forms/FormActions";

type Draft = Omit<Milestone, "id" | "createdAt" | "updatedAt">;

export function MilestoneForm({
  projectId,
  initial,
  nextOrder = 0,
  onClose,
}: {
  projectId: string;
  initial?: Milestone;
  nextOrder?: number;
  onClose: () => void;
}) {
  const { create, update } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    projectId,
    name: initial?.name ?? "",
    startDate: initial?.startDate ?? null,
    endDate: initial?.endDate ?? null,
    status: initial?.status ?? "planned",
    order: initial?.order ?? nextOrder,
    dependsOn: initial?.dependsOn ?? [],
    commitScope: initial?.commitScope ?? "",
    notes: initial?.notes ?? "",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const datesInvalid = !!d.startDate && !!d.endDate && d.endDate < d.startDate;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim() || datesInvalid) return;
    if (initial) update("milestones", initial.id, d);
    else create("milestones", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Milestone name *">
        <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus required />
      </Field>

      <FormGrid>
        <Field label="Start date" className="mt-3.5">
          <TextInput type="date" value={d.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
        </Field>
        <Field
          label="End date"
          className="mt-3.5"
          hint={datesInvalid ? "End date must fall on or after the start date." : undefined}
        >
          <TextInput type="date" value={d.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
        </Field>
        <Field label="Status" className="mt-3.5">
          <Select
            options={MILESTONE_STATUSES}
            value={d.status}
            onChange={(e) => set("status", e.target.value as Draft["status"])}
          />
        </Field>
        <Field label="Order" className="mt-3.5" hint="Lower numbers sort first.">
          <NumberInput value={d.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
        </Field>
      </FormGrid>

      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions
        onCancel={onClose}
        saveLabel={initial ? "Save changes" : "Add milestone"}
        saveDisabled={!d.name.trim() || datesInvalid}
      />
    </form>
  );
}
