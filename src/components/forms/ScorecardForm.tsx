"use client";

import { useState } from "react";
import type { Scorecard } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, NumberInput, TextArea, TextInput } from "@/components/ui/Field";
import { todayISO } from "@/lib/utils";
import { FormActions } from "./FormActions";

type Draft = Omit<Scorecard, "id" | "createdAt" | "updatedAt">;

const NUM_FIELDS: Array<{ key: keyof Draft; label: string }> = [
  { key: "dials", label: "Dials made" },
  { key: "emails", label: "Emails sent" },
  { key: "linkedinMessages", label: "LinkedIn messages" },
  { key: "replies", label: "Replies received" },
  { key: "conversations", label: "Conversations" },
  { key: "leadsCreated", label: "Leads created" },
  { key: "meetingsBooked", label: "Meetings booked" },
  { key: "proposalsSent", label: "Proposals sent" },
  { key: "productHours", label: "Product / build hours" },
  { key: "revenueClosed", label: "Revenue closed" },
];

export function ScorecardForm({ initial, onClose }: { initial?: Scorecard; onClose: () => void }) {
  const { create, update, scorecards } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    date: initial?.date ?? todayISO(),
    dials: initial?.dials ?? 0,
    emails: initial?.emails ?? 0,
    linkedinMessages: initial?.linkedinMessages ?? 0,
    replies: initial?.replies ?? 0,
    conversations: initial?.conversations ?? 0,
    leadsCreated: initial?.leadsCreated ?? 0,
    meetingsBooked: initial?.meetingsBooked ?? 0,
    proposalsSent: initial?.proposalsSent ?? 0,
    productHours: initial?.productHours ?? 0,
    seoWork: initial?.seoWork ?? "",
    revenueClosed: initial?.revenueClosed ?? 0,
    wins: initial?.wins ?? "",
    problems: initial?.problems ?? "",
    lessons: initial?.lessons ?? "",
    avoidTomorrow: initial?.avoidTomorrow ?? "",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // one scorecard per day — upsert by date
    const existing = scorecards.find((s) => s.date === d.date && s.id !== initial?.id);
    if (initial) update("scorecards", initial.id, d);
    else if (existing) update("scorecards", existing.id, d);
    else create("scorecards", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Date">
        <TextInput type="date" value={d.date} onChange={(e) => set("date", e.target.value)} className="max-w-[200px]" />
      </Field>

      <p className="eyebrow mt-5 mb-2.5">Activity</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-3">
        {NUM_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <NumberInput
              min={0}
              value={d[f.key] as number}
              onChange={(e) => set(f.key, Number(e.target.value) as Draft[typeof f.key])}
            />
          </Field>
        ))}
      </div>

      <Field label="SEO work done" className="mt-4">
        <TextInput value={d.seoWork} onChange={(e) => set("seoWork", e.target.value)} placeholder="e.g. Published one article" />
      </Field>

      <p className="eyebrow mt-5 mb-2.5">Reflection</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Main wins">
          <TextArea value={d.wins} onChange={(e) => set("wins", e.target.value)} rows={2} />
        </Field>
        <Field label="Main problems">
          <TextArea value={d.problems} onChange={(e) => set("problems", e.target.value)} rows={2} />
        </Field>
        <Field label="Lessons from today">
          <TextArea value={d.lessons} onChange={(e) => set("lessons", e.target.value)} rows={2} />
        </Field>
        <Field label="What to avoid tomorrow">
          <TextArea value={d.avoidTomorrow} onChange={(e) => set("avoidTomorrow", e.target.value)} rows={2} />
        </Field>
      </div>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Save scorecard"} />
    </form>
  );
}
