"use client";

import { useState } from "react";
import {
  LEAD_QUALITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type Lead,
} from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, NumberInput, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "./FormActions";

type Draft = Omit<Lead, "id" | "createdAt" | "updatedAt">;

export function LeadForm({ initial, onClose }: { initial?: Lead; onClose: () => void }) {
  const { create, update, settings } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    company: initial?.company ?? "",
    contactName: initial?.contactName ?? "",
    contactRole: initial?.contactRole ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    linkedinUrl: initial?.linkedinUrl ?? "",
    industry: initial?.industry ?? "",
    companyType: initial?.companyType ?? "",
    source: initial?.source ?? "cold call",
    status: initial?.status ?? "new",
    quality: initial?.quality ?? "medium",
    painPoint: initial?.painPoint ?? "",
    objection: initial?.objection ?? "",
    buyingSignal: initial?.buyingSignal ?? "",
    lastContact: initial?.lastContact ?? null,
    nextFollowUp: initial?.nextFollowUp ?? null,
    notes: initial?.notes ?? "",
    solutionIdea: initial?.solutionIdea ?? "",
    estimatedValue: initial?.estimatedValue ?? 0,
    owner: initial?.owner ?? settings.founderName ?? "Emil",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.company.trim()) return;
    if (initial) update("leads", initial.id, d);
    else create("leads", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <FormGrid>
        <Field label="Company name *">
          <TextInput value={d.company} onChange={(e) => set("company", e.target.value)} autoFocus required placeholder="Acme Capital" />
        </Field>
        <Field label="Industry">
          <TextInput value={d.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Asset Management" />
        </Field>
        <Field label="Contact name">
          <TextInput value={d.contactName} onChange={(e) => set("contactName", e.target.value)} />
        </Field>
        <Field label="Contact role">
          <TextInput value={d.contactRole} onChange={(e) => set("contactRole", e.target.value)} placeholder="Managing Partner" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={d.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Phone">
          <TextInput value={d.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="LinkedIn URL">
          <TextInput value={d.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Company type">
          <TextInput value={d.companyType} onChange={(e) => set("companyType", e.target.value)} placeholder="Boutique fund manager" />
        </Field>
        <Field label="Source">
          <Select options={LEAD_SOURCES} value={d.source} onChange={(e) => set("source", e.target.value as Draft["source"])} />
        </Field>
        <Field label="Status">
          <Select options={LEAD_STATUSES} value={d.status} onChange={(e) => set("status", e.target.value as Draft["status"])} />
        </Field>
        <Field label="Lead quality">
          <Select options={LEAD_QUALITIES} value={d.quality} onChange={(e) => set("quality", e.target.value as Draft["quality"])} />
        </Field>
        <Field label="Estimated value">
          <NumberInput value={d.estimatedValue} min={0} onChange={(e) => set("estimatedValue", Number(e.target.value))} />
        </Field>
        <Field label="Last contact">
          <TextInput type="date" value={d.lastContact ?? ""} onChange={(e) => set("lastContact", e.target.value || null)} />
        </Field>
        <Field label="Next follow-up">
          <TextInput type="date" value={d.nextFollowUp ?? ""} onChange={(e) => set("nextFollowUp", e.target.value || null)} />
        </Field>
        <Field label="Owner">
          <TextInput value={d.owner} onChange={(e) => set("owner", e.target.value)} />
        </Field>
      </FormGrid>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 mt-3.5">
        <Field label="Pain point">
          <TextArea value={d.painPoint} onChange={(e) => set("painPoint", e.target.value)} rows={2} />
        </Field>
        <Field label="Objection">
          <TextArea value={d.objection} onChange={(e) => set("objection", e.target.value)} rows={2} />
        </Field>
        <Field label="Buying signal">
          <TextArea value={d.buyingSignal} onChange={(e) => set("buyingSignal", e.target.value)} rows={2} />
        </Field>
        <Field label="Potential solution idea">
          <TextArea value={d.solutionIdea} onChange={(e) => set("solutionIdea", e.target.value)} rows={2} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Add lead"} saveDisabled={!d.company.trim()} />
    </form>
  );
}
