"use client";

import { useMemo, useState } from "react";
import { Upload, Crosshair, ArrowUpRight, Trash2 } from "lucide-react";
import { useStore, useTargets, useSettings } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextInput } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { ImportCsvModal } from "@/components/targets/ImportCsvModal";
import { targetToLead } from "@/lib/targets/promote";
import type { NewTarget } from "@/lib/targets/mapping";
import type { Target } from "@/lib/types";

function matches(t: Target, q: string): boolean {
  const hay = [t.company, t.contactName, t.contactRole, t.email, t.industry, t.location, t.notes]
    .join(" ").toLowerCase();
  return hay.includes(q);
}

export default function TargetsPage() {
  const store = useStore();
  const targets = useTargets();
  const settings = useSettings();

  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? targets.filter((t) => matches(t, q)) : targets;
  }, [targets, query]);

  const onImport = (records: NewTarget[]) => {
    for (const r of records) store.create("targets", r);
  };

  const promote = (t: Target) => {
    store.create("leads", targetToLead(t, settings.founderName));
    store.remove("targets", t.id);
  };

  const clearAll = () => {
    for (const t of targets) store.remove("targets", t.id);
    setConfirmClear(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Targets"
        subtitle="Your imported prospect list. Search it, then promote a target into a Lead when you start engaging."
        actions={
          <div className="flex items-center gap-2">
            {targets.length > 0 && (
              <button className="btn" onClick={() => setConfirmClear(true)}>
                <Trash2 size={15} /> Clear all
              </button>
            )}
            <button className="btn btn-accent" onClick={() => setImporting(true)}>
              <Upload size={15} /> Import CSV
            </button>
          </div>
        }
      />

      {targets.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Crosshair}
            title="No targets yet"
            message="Import a CSV of prospects to build your targets list, then search and promote them."
            action={<button className="btn btn-accent" onClick={() => setImporting(true)}><Upload size={15} /> Import CSV</button>}
          />
        </Panel>
      ) : (
        <Panel
          title={`${filtered.length} of ${targets.length}`}
          action={
            <TextInput
              placeholder="Search targets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56"
            />
          }
          noPad
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="text-left text-[var(--color-dim)] border-b border-[var(--color-line)]">
                  <th className="p-2.5 font-medium">Company</th>
                  <th className="p-2.5 font-medium">Contact</th>
                  <th className="p-2.5 font-medium">Role</th>
                  <th className="p-2.5 font-medium">Email</th>
                  <th className="p-2.5 font-medium">Industry</th>
                  <th className="p-2.5 font-medium">Location</th>
                  <th className="p-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--color-line)] hover:bg-[var(--color-surface-2)]">
                    <td className="p-2.5 text-[var(--color-ink)] font-medium">{t.company || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.contactName || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.contactRole || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)] truncate max-w-[200px]">{t.email || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.industry || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.location || "—"}</td>
                    <td className="p-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button className="btn btn-sm" title="Promote to lead" onClick={() => promote(t)}>
                          <ArrowUpRight size={14} /> Promote
                        </button>
                        <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => store.remove("targets", t.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <ImportCsvModal
        open={importing}
        onClose={() => setImporting(false)}
        existing={targets}
        onImport={onImport}
      />

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Clear all targets?"
        message={`This permanently removes all ${targets.length} targets. Promoted leads are not affected.`}
        confirmLabel="Clear all"
      />
    </div>
  );
}
