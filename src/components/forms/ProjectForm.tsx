"use client";

import { useState } from "react";
import {
  PRIORITIES,
  PROJECT_STAGES,
  PROJECT_TYPES,
  type Project,
} from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "./FormActions";

type Draft = Omit<Project, "id" | "createdAt" | "updatedAt">;

export function ProjectForm({ initial, onClose }: { initial?: Project; onClose: () => void }) {
  const { create, update } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    name: initial?.name ?? "",
    company: initial?.company ?? "",
    type: initial?.type ?? "demo",
    stage: initial?.stage ?? "idea",
    priority: initial?.priority ?? "medium",
    startDate: initial?.startDate ?? null,
    dueDate: initial?.dueDate ?? null,
    currentMilestone: initial?.currentMilestone ?? "",
    currentBlocker: initial?.currentBlocker ?? "",
    nextAction: initial?.nextAction ?? "",
    deliverables: initial?.deliverables ?? "",
    notes: initial?.notes ?? "",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim()) return;
    if (initial) update("projects", initial.id, d);
    else create("projects", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <FormGrid>
        <Field label="Project name *">
          <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus required />
        </Field>
        <Field label="Client / company">
          <TextInput value={d.company} onChange={(e) => set("company", e.target.value)} />
        </Field>
        <Field label="Project type">
          <Select options={PROJECT_TYPES} value={d.type} onChange={(e) => set("type", e.target.value as Draft["type"])} />
        </Field>
        <Field label="Stage">
          <Select options={PROJECT_STAGES} value={d.stage} onChange={(e) => set("stage", e.target.value as Draft["stage"])} />
        </Field>
        <Field label="Priority">
          <Select options={PRIORITIES} value={d.priority} onChange={(e) => set("priority", e.target.value as Draft["priority"])} />
        </Field>
        <div />
        <Field label="Start date">
          <TextInput type="date" value={d.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
        </Field>
        <Field label="Due date">
          <TextInput type="date" value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
        </Field>
      </FormGrid>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 mt-3.5">
        <Field label="Current milestone">
          <TextInput value={d.currentMilestone} onChange={(e) => set("currentMilestone", e.target.value)} />
        </Field>
        <Field label="Current blocker">
          <TextInput value={d.currentBlocker} onChange={(e) => set("currentBlocker", e.target.value)} />
        </Field>
      </div>
      <Field label="Next action" className="mt-3.5">
        <TextInput value={d.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
      </Field>
      <Field label="Deliverables" className="mt-3.5">
        <TextArea value={d.deliverables} onChange={(e) => set("deliverables", e.target.value)} rows={2} />
      </Field>
      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Add project"} saveDisabled={!d.name.trim()} />
    </form>
  );
}
