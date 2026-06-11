"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Layers, Plus, Search, Pencil, Trash2, Flame } from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailGrid, DetailRow, FilterSelect } from "@/components/ui/Detail";
import { PainPointForm } from "@/components/forms/PainPointForm";
import { URGENCIES } from "@/lib/types";
import { urgencyTone } from "@/lib/badges";

function PainBankView() {
  const { painPoints, remove } = useStore();
  const focusId = useFocusParam();

  const [query, setQuery] = useState("");
  const [fIndustry, setFIndustry] = useState("all");
  const [fUrgency, setFUrgency] = useState("all");
  const [fWtp, setFWtp] = useState("all");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) setViewId(focusId);
  }, [focusId]);

  const industries = useMemo(
    () => Array.from(new Set(painPoints.map((p) => p.industry).filter(Boolean))).sort(),
    [painPoints],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return painPoints
      .filter((p) => {
        if (fIndustry !== "all" && p.industry !== fIndustry) return false;
        if (fUrgency !== "all" && p.urgency !== fUrgency) return false;
        if (fWtp !== "all" && p.willingnessToPay !== fWtp) return false;
        if (q) {
          const hay = `${p.painPoint} ${p.industry} ${p.companyType} ${p.whoMentioned} ${p.possibleSolution} ${p.notes}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.frequency - a.frequency);
  }, [painPoints, query, fIndustry, fUrgency, fWtp]);

  const maxFreq = Math.max(1, ...painPoints.map((p) => p.frequency));
  const view = painPoints.find((p) => p.id === viewId) ?? null;
  const edit = painPoints.find((p) => p.id === editId) ?? null;

  // top opportunities: high freq + high WTP
  const top = useMemo(
    () =>
      [...painPoints]
        .sort((a, b) => b.frequency - a.frequency)
        .filter((p) => p.willingnessToPay === "high" || p.frequency >= maxFreq * 0.7)
        .slice(0, 3),
    [painPoints, maxFreq],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pain Point Bank"
        subtitle="Every repeated market problem in one place — so you can see patterns and decide what to build next."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Pain Point
          </button>
        }
      />

      {/* Top patterns */}
      {top.length > 0 && (
        <Panel title="Strongest patterns to productise">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {top.map((p) => (
              <button key={p.id} onClick={() => setViewId(p.id)} className="text-left rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3.5 hover:border-[var(--color-line-strong)] transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center gap-1 tnum text-[0.78rem] text-[var(--color-accent-soft)]"><Flame size={13} /> {p.frequency}×</span>
                  <Badge tone={urgencyTone(p.willingnessToPay)} dot={false}>{p.willingnessToPay} WTP</Badge>
                </div>
                <p className="text-[0.84rem] text-[var(--color-ink)] leading-snug line-clamp-2">{p.painPoint}</p>
                <p className="text-[0.74rem] text-[var(--color-dim)] mt-1.5">{p.industry}</p>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-dim)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pain points…" className="input" style={{ paddingLeft: "2.1rem", height: 34 }} />
        </div>
        <FilterSelect label="Industry" value={fIndustry} onChange={setFIndustry} options={[{ value: "all", label: "All industries" }, ...industries.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Urgency" value={fUrgency} onChange={setFUrgency} options={[{ value: "all", label: "Any urgency" }, ...URGENCIES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="WTP" value={fWtp} onChange={setFWtp} options={[{ value: "all", label: "Any WTP" }, ...URGENCIES.map((s) => ({ value: s, label: s }))]} />
      </div>

      <Panel noPad>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={painPoints.length === 0 ? "No pain points yet" : "No pain points match"}
            message={painPoints.length === 0 ? "Capture the problems prospects keep mentioning — patterns become products." : "Try clearing a filter."}
            action={painPoints.length === 0 ? <button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Add Pain Point</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pain point</th>
                  <th>Industry</th>
                  <th>Frequency</th>
                  <th>Urgency</th>
                  <th>WTP</th>
                  <th>Possible solution</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} onClick={() => setViewId(p.id)}>
                    <td className="max-w-xs">
                      <div className="font-medium text-[var(--color-ink)] line-clamp-1">{p.painPoint}</div>
                      <div className="text-[0.74rem] text-[var(--color-dim)]">{p.companyType}</div>
                    </td>
                    <td className="text-[var(--color-muted)]">{p.industry}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="tnum text-[var(--color-ink-soft)] w-5">{p.frequency}</span>
                        <span className="h-[3px] w-16 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                          <span className="block h-full rounded-full" style={{ width: `${(p.frequency / maxFreq) * 100}%`, background: "var(--color-accent)", opacity: 0.6 }} />
                        </span>
                      </div>
                    </td>
                    <td><Badge tone={urgencyTone(p.urgency)} dot={false}>{p.urgency}</Badge></td>
                    <td><Badge tone={urgencyTone(p.willingnessToPay)} dot={false}>{p.willingnessToPay}</Badge></td>
                    <td className="max-w-xs text-[var(--color-muted)] line-clamp-1">{p.possibleSolution || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={!!view}
        onClose={() => setViewId(null)}
        title={view?.painPoint ?? ""}
        subtitle={view ? `${view.industry}${view.companyType ? ` · ${view.companyType}` : ""}` : ""}
        size="lg"
        footer={
          view && (
            <>
              <button className="btn" onClick={() => { setEditId(view.id); setViewId(null); }}><Pencil size={15} /> Edit</button>
              <button className="btn" onClick={() => setDeleteId(view.id)} style={{ color: "var(--color-accent-soft)" }}><Trash2 size={15} /> Delete</button>
            </>
          )
        }
      >
        {view && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <span className="chip tnum"><Flame size={12} /> {view.frequency}× mentioned</span>
              <Badge tone={urgencyTone(view.urgency)} dot={false}>{view.urgency} urgency</Badge>
              <Badge tone={urgencyTone(view.willingnessToPay)} dot={false}>{view.willingnessToPay} willingness to pay</Badge>
            </div>
            <DetailGrid>
              <DetailRow label="Who mentioned it" full>{view.whoMentioned}</DetailRow>
              <DetailRow label="Current workaround" full>{view.workaround}</DetailRow>
              <DetailRow label="Possible solution" full>{view.possibleSolution}</DetailRow>
              <DetailRow label="Notes" full>{view.notes}</DetailRow>
            </DetailGrid>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add Pain Point" subtitle="Capture a repeated market problem">
        <PainPointForm onClose={() => setCreating(false)} />
      </Modal>
      <Modal open={!!edit} onClose={() => setEditId(null)} title="Edit pain point">
        {edit && <PainPointForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) remove("painPoints", deleteId); setViewId(null); }}
        title="Delete pain point?"
        message="This permanently removes the pain point from your bank."
      />
    </div>
  );
}

export default function PainBankPage() {
  return (
    <Suspense fallback={null}>
      <PainBankView />
    </Suspense>
  );
}
