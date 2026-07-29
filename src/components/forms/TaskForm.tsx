"use client";

import { useState } from "react";
import {
  PRIORITIES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type Task,
} from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "./FormActions";

type Draft = Omit<Task, "id" | "createdAt" | "updatedAt">;

export function TaskForm({
  initial,
  presetLink,
  onClose,
}: {
  initial?: Task;
  presetLink?: { kind: "lead" | "project"; id: string };
  onClose: () => void;
}) {
  const { create, update, leads, projects, milestones } = useStore();

  const initialLinkValue = initial
    ? initial.linkKind === "none"
      ? ""
      : `${initial.linkKind}:${initial.linkId}`
    : presetLink
      ? `${presetLink.kind}:${presetLink.id}`
      : "";

  const [linkValue, setLinkValue] = useState(initialLinkValue);
  const [linkKind, linkId] = linkValue ? linkValue.split(":") : ["none", ""];
  const [d, setD] = useState<Omit<Draft, "linkKind" | "linkId">>(() => ({
    title: initial?.title ?? "",
    category: initial?.category ?? "follow-up",
    priority: initial?.priority ?? "medium",
    status: initial?.status ?? "not started",
    dueDate: initial?.dueDate ?? null,
    notes: initial?.notes ?? "",
    milestoneId: initial?.milestoneId ?? null,
  }));

  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    let linkKind: Draft["linkKind"] = "none";
    let linkId: string | null = null;
    if (linkValue) {
      const [kind, id] = linkValue.split(":");
      linkKind = kind as Draft["linkKind"];
      linkId = id;
    }
    const payload: Draft = { ...d, linkKind, linkId };
    if (initial) update("tasks", initial.id, payload);
    else create("tasks", payload);

    // Logging a follow-up task against a lead sets that lead's next follow-up date.
    if (linkKind === "lead" && linkId && payload.category === "follow-up" && payload.dueDate) {
      update("leads", linkId, { nextFollowUp: payload.dueDate.slice(0, 10) });
    }
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Task title *">
        <TextInput value={d.title} onChange={(e) => set("title", e.target.value)} autoFocus required placeholder="Follow up with…" />
      </Field>

      <FormGrid>
        <Field label="Related lead / project" className="mt-3.5 sm:col-span-2">
          <select
            className="select"
            value={linkValue}
            onChange={(e) => {
              setLinkValue(e.target.value);
              set("milestoneId", null);
            }}
          >
            <option value="">— None —</option>
            {leads.length > 0 && (
              <optgroup label="Leads">
                {leads.map((l) => (
                  <option key={l.id} value={`lead:${l.id}`}>
                    {l.company}
                  </option>
                ))}
              </optgroup>
            )}
            {projects.length > 0 && (
              <optgroup label="Projects">
                {projects.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        {linkKind === "project" && linkId && (
          <Field label="Milestone" className="mt-3.5">
            <select
              className="select"
              value={d.milestoneId ?? ""}
              onChange={(e) => set("milestoneId", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {milestones
                .filter((m) => m.projectId === linkId)
                .sort((a, b) => a.order - b.order)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Category">
          <Select options={TASK_CATEGORIES} value={d.category} onChange={(e) => set("category", e.target.value as Draft["category"])} />
        </Field>
        <Field label="Priority">
          <Select options={PRIORITIES} value={d.priority} onChange={(e) => set("priority", e.target.value as Draft["priority"])} />
        </Field>
        <Field label="Status">
          <Select options={TASK_STATUSES} value={d.status} onChange={(e) => set("status", e.target.value as Draft["status"])} />
        </Field>
        <Field label="Due date">
          <TextInput type="date" value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
        </Field>
      </FormGrid>

      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
      </Field>

      <FormActions onCancel={onClose} saveLabel={initial ? "Save changes" : "Add task"} saveDisabled={!d.title.trim()} />
    </form>
  );
}
