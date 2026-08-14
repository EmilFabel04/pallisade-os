"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  PhoneCall,
  Plus,
  Search,
  Pencil,
  Trash2,
  Sparkles,
  Loader2,
  Copy,
  Check,
  ArrowRight,
  Target,
  Lightbulb,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailRow } from "@/components/ui/Detail";
import { FilterSelect } from "@/components/ui/Detail";
import { InteractionForm } from "@/components/forms/InteractionForm";
import { INTERACTION_TYPES, type Interaction } from "@/lib/types";
import { interactionTone } from "@/lib/badges";
import { fmtDate, relativeDay } from "@/lib/utils";
import { requestCallSummary, AIUnavailable } from "@/lib/aiClient";

function InteractionsView() {
  const { interactions, update, remove, settings } = useStore();
  const focusId = useFocusParam();

  const [query, setQuery] = useState("");
  const [fType, setFType] = useState("all");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) setViewId(focusId);
  }, [focusId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...interactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((it) => {
        if (fType !== "all" && it.type !== fType) return false;
        if (q) {
          const hay = `${it.company} ${it.contact} ${it.rawNotes} ${it.whatTheySaid} ${it.painPoints}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [interactions, query, fType]);

  const view = interactions.find((i) => i.id === viewId) ?? null;
  const edit = interactions.find((i) => i.id === editId) ?? null;

  const runSummary = async (it: Interaction) => {
    setGenerating(true);
    setSummaryError(null);
    // Calls Claude Sonnet 4.6 via /api/ai. No local fallback — a failure
    // (no key, model error, empty result, network) surfaces as an error
    // state instead of being rendered as a summary.
    try {
      const summary = await requestCallSummary({
        rawNotes: it.rawNotes,
        whatTheySaid: it.whatTheySaid,
        painPoints: it.painPoints,
        objections: it.objections,
        buyingSignals: it.buyingSignals,
        company: it.company,
        contact: it.contact,
        context: { businessName: settings.businessName, services: settings.services },
      });
      update("interactions", it.id, { summary });
    } catch (err) {
      setSummaryError(err instanceof AIUnavailable ? err.message : "Something went wrong generating the summary.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Interactions"
        subtitle="Every call, reply and meeting — logged, then turned into structured intelligence by AI."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Log Interaction
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-dim)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search interactions…" className="input" style={{ paddingLeft: "2.1rem", height: 34 }} />
        </div>
        <FilterSelect label="Type" value={fType} onChange={setFType} options={[{ value: "all", label: "All types" }, ...INTERACTION_TYPES.map((t) => ({ value: t, label: t }))]} />
      </div>

      <Panel noPad>
        {filtered.length === 0 ? (
          <EmptyState
            icon={PhoneCall}
            title={interactions.length === 0 ? "No interactions logged" : "No interactions match"}
            message={interactions.length === 0 ? "Log your first call or reply — then generate an AI summary from the rough notes." : "Try a different filter or search."}
            action={interactions.length === 0 ? <button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Log Interaction</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Date</th>
                  <th>AI summary</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} onClick={() => setViewId(it.id)}>
                    <td><Badge tone={interactionTone(it.type)}>{it.type}</Badge></td>
                    <td className="font-medium text-[var(--color-ink)]">{it.company}</td>
                    <td className="text-[var(--color-ink-soft)]">{it.contact || "—"}</td>
                    <td className="tnum text-[var(--color-muted)]">{fmtDate(it.date)}</td>
                    <td>
                      {it.summary ? (
                        <span className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--color-positive)]"><Check size={13} /> Generated</span>
                      ) : (
                        <span className="text-[0.78rem] text-[var(--color-dim)]">—</span>
                      )}
                    </td>
                    <td>
                      {it.followUpRequired ? (
                        <span className="text-[0.8rem] text-[var(--color-accent-soft)]">{it.followUpDate ? relativeDay(it.followUpDate) : "Required"}</span>
                      ) : (
                        <span className="text-[var(--color-dim)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Detail + AI */}
      <Modal
        open={!!view}
        onClose={() => { setViewId(null); setSummaryError(null); }}
        title={view ? `${view.type} — ${view.company}` : ""}
        subtitle={view ? `${view.contact || "—"} · ${fmtDate(view.date)}` : ""}
        size="lg"
        footer={
          view && (
            <>
              <button className="btn" onClick={() => { setEditId(view.id); setViewId(null); }}>
                <Pencil size={15} /> Edit
              </button>
              <button className="btn" onClick={() => setDeleteId(view.id)} style={{ color: "var(--color-accent-soft)" }}>
                <Trash2 size={15} /> Delete
              </button>
            </>
          )
        }
      >
        {view && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
              <DetailRow label="Raw notes" full>{view.rawNotes}</DetailRow>
              <DetailRow label="What they said">{view.whatTheySaid}</DetailRow>
              <DetailRow label="Pain points mentioned">{view.painPoints}</DetailRow>
              <DetailRow label="Objections">{view.objections}</DetailRow>
              <DetailRow label="Buying signals">{view.buyingSignals}</DetailRow>
            </div>

            {/* AI summary block */}
            <div className="rounded-lg border border-[var(--color-line)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
                <span className="inline-flex items-center gap-2 text-[0.78rem] font-medium text-[var(--color-ink)]">
                  <Sparkles size={14} className="text-[var(--color-accent)]" /> AI Call Summary
                </span>
                <button className="btn btn-sm btn-accent" onClick={() => runSummary(view)} disabled={generating || !view.rawNotes.trim()}>
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {view.summary ? "Regenerate" : "Generate Call Summary"}
                </button>
              </div>
              <div className="p-4">
                {summaryError && (
                  <p className="text-[0.78rem] text-[var(--color-accent)] mb-3">{summaryError}</p>
                )}
                {!view.summary ? (
                  <p className="text-[0.82rem] text-[var(--color-muted)] leading-relaxed">
                    {view.rawNotes.trim()
                      ? "Turn the rough notes above into a clean summary, key pain points, objections, buying signals and a suggested follow-up message."
                      : "Add raw notes first, then generate a structured summary."}
                  </p>
                ) : (
                  <SummaryView summary={view.summary} />
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Log Interaction" subtitle="Record a call, reply or meeting">
        <InteractionForm onClose={() => setCreating(false)} />
      </Modal>
      <Modal open={!!edit} onClose={() => setEditId(null)} title="Edit interaction">
        {edit && <InteractionForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) remove("interactions", deleteId); setViewId(null); }}
        title="Delete interaction?"
        message="This permanently removes the logged interaction and its AI summary."
      />
    </div>
  );
}

function SummaryView({ summary }: { summary: NonNullable<Interaction["summary"]> }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(summary.suggestedFollowUpMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-4">
      <p className="text-[0.86rem] text-[var(--color-ink-soft)] leading-relaxed">{summary.cleanSummary}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryList title="Key pain points" items={summary.keyPainPoints} tone="accent" />
        <SummaryList title="Objections" items={summary.objections} tone="warning" />
        <SummaryList title="Buying signals" items={summary.buyingSignals} tone="positive" />
      </div>

      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow">Suggested follow-up message</p>
          <button className="btn btn-sm btn-ghost" onClick={copy}>
            {copied ? <Check size={13} className="text-[var(--color-positive)]" /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[0.84rem] text-[var(--color-ink-soft)] leading-relaxed whitespace-pre-wrap">{summary.suggestedFollowUpMessage}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border border-[var(--color-line)] p-3.5">
          <p className="eyebrow mb-1.5 inline-flex items-center gap-1.5"><ArrowRight size={12} className="text-[var(--color-accent)]" /> Suggested next step</p>
          <p className="text-[0.83rem] text-[var(--color-ink-soft)] leading-relaxed">{summary.suggestedNextStep}</p>
        </div>
        <div className="rounded-md border border-[var(--color-line)] p-3.5">
          <p className="eyebrow mb-1.5 inline-flex items-center gap-1.5"><Lightbulb size={12} className="text-[var(--color-accent)]" /> Possible offer angle</p>
          <p className="text-[0.83rem] text-[var(--color-ink-soft)] leading-relaxed">{summary.offerAngle}</p>
        </div>
      </div>
    </div>
  );
}

function SummaryList({ title, items, tone }: { title: string; items: string[]; tone: "accent" | "warning" | "positive" }) {
  const color = tone === "accent" ? "var(--color-accent)" : tone === "warning" ? "var(--color-warning)" : "var(--color-positive)";
  return (
    <div className="rounded-md border border-[var(--color-line)] p-3">
      <p className="eyebrow mb-2 inline-flex items-center gap-1.5"><Target size={11} style={{ color }} /> {title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-[0.79rem] text-[var(--color-ink-soft)] leading-snug flex gap-1.5">
            <span style={{ color }}>·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function InteractionsPage() {
  return (
    <Suspense fallback={null}>
      <InteractionsView />
    </Suspense>
  );
}
