"use client";

import { useMemo, useState } from "react";
import { MILESTONE_STATUSES, type Milestone } from "@/lib/types";
import { useStore } from "@/lib/store";
import { detectCycles } from "@/lib/projects/schedule";
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
  const { milestones, create, update } = useStore();
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

  const siblings = milestones
    .filter((m) => m.projectId === projectId && m.id !== initial?.id)
    .sort((a, b) => a.order - b.order);

  // Validate against the graph as it WOULD be after this save.
  const wouldCycle = useMemo(() => {
    const draftAsRecord: Milestone = {
      ...(initial ?? { id: "__draft", createdAt: "", updatedAt: "" }),
      ...d,
      id: initial?.id ?? "__draft",
    } as Milestone;
    const next = [...siblings, draftAsRecord];
    return detectCycles(next).length > 0;
  }, [d, initial, siblings]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim() || datesInvalid || wouldCycle) return;
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

      {siblings.length > 0 && (
        <Field
          label="Depends on"
          className="mt-3.5"
          hint={wouldCycle ? "That would create a dependency loop." : "Cmd/Ctrl-click to select several."}
        >
          <select
            multiple
            className="select h-24"
            value={d.dependsOn}
            onChange={(e) =>
              set("dependsOn", Array.from(e.target.selectedOptions, (o) => o.value))
            }
          >
            {siblings.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions
        onCancel={onClose}
        saveLabel={initial ? "Save changes" : "Add milestone"}
        saveDisabled={!d.name.trim() || datesInvalid || wouldCycle}
      />
    </form>
  );
}
