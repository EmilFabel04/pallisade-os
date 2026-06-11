"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  PhoneCall,
  ExternalLink,
  Mail,
  Phone,
  Linkedin,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailGrid, DetailRow, FilterSelect } from "@/components/ui/Detail";
import { LeadForm } from "@/components/forms/LeadForm";
import { InteractionForm } from "@/components/forms/InteractionForm";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_QUALITIES,
  type Lead,
} from "@/lib/types";
import { leadStatusTone, qualityTone } from "@/lib/badges";
import { fmtCurrency, fmtDate, relativeDay, isOverdue, cn } from "@/lib/utils";

function LeadsView() {
  const { leads, remove, settings } = useStore();
  const focusId = useFocusParam();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fSource, setFSource] = useState("all");
  const [fIndustry, setFIndustry] = useState("all");
  const [fQuality, setFQuality] = useState("all");
  const [fFollow, setFFollow] = useState("all");

  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [logFor, setLogFor] = useState<Lead | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) setViewId(focusId);
  }, [focusId]);

  const industries = useMemo(
    () => Array.from(new Set(leads.map((l) => l.industry).filter(Boolean))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (fStatus !== "all" && l.status !== fStatus) return false;
      if (fSource !== "all" && l.source !== fSource) return false;
      if (fIndustry !== "all" && l.industry !== fIndustry) return false;
      if (fQuality !== "all" && l.quality !== fQuality) return false;
      if (fFollow !== "all") {
        const nf = l.nextFollowUp?.slice(0, 10);
        if (fFollow === "none" && nf) return false;
        if (fFollow === "overdue" && !(nf && isOverdue(l.nextFollowUp))) return false;
        if (fFollow === "scheduled" && !nf) return false;
      }
      if (q) {
        const hay = `${l.company} ${l.contactName} ${l.contactRole} ${l.email} ${l.industry} ${l.painPoint} ${l.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, query, fStatus, fSource, fIndustry, fQuality, fFollow]);

  const view = leads.find((l) => l.id === viewId) ?? null;
  const edit = leads.find((l) => l.id === editId) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        subtitle="Your CRM — every company in the pipeline, who they are and what they need."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Lead
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads…"
            className="input"
            style={{ paddingLeft: "2.1rem", height: 34 }}
          />
        </div>
        <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={[{ value: "all", label: "All statuses" }, ...LEAD_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Source" value={fSource} onChange={setFSource} options={[{ value: "all", label: "All sources" }, ...LEAD_SOURCES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Quality" value={fQuality} onChange={setFQuality} options={[{ value: "all", label: "All quality" }, ...LEAD_QUALITIES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Industry" value={fIndustry} onChange={setFIndustry} options={[{ value: "all", label: "All industries" }, ...industries.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Follow-up" value={fFollow} onChange={setFFollow} options={[
          { value: "all", label: "Any follow-up" },
          { value: "overdue", label: "Overdue" },
          { value: "scheduled", label: "Scheduled" },
          { value: "none", label: "No date set" },
        ]} />
      </div>

      <Panel noPad>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={leads.length === 0 ? "No leads yet" : "No leads match these filters"}
            message={leads.length === 0 ? "Add your first lead to start building the pipeline." : "Try clearing a filter or adjusting your search."}
            action={leads.length === 0 ? <button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Add Lead</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Quality</th>
                  <th>Source</th>
                  <th>Next follow-up</th>
                  <th className="text-right">Est. value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} onClick={() => setViewId(l.id)}>
                    <td>
                      <div className="font-medium text-[var(--color-ink)]">{l.company}</div>
                      <div className="text-[0.74rem] text-[var(--color-dim)]">{l.industry || "—"}</div>
                    </td>
                    <td>
                      <div className="text-[var(--color-ink-soft)]">{l.contactName || "—"}</div>
                      <div className="text-[0.74rem] text-[var(--color-dim)]">{l.contactRole}</div>
                    </td>
                    <td><Badge tone={leadStatusTone(l.status)}>{l.status}</Badge></td>
                    <td><Badge tone={qualityTone(l.quality)} dot={false}>{l.quality}</Badge></td>
                    <td className="text-[var(--color-muted)]">{l.source}</td>
                    <td>
                      {l.nextFollowUp ? (
                        <span className={cn("tnum text-[0.8rem]", isOverdue(l.nextFollowUp) ? "text-[var(--color-accent-soft)]" : "text-[var(--color-ink-soft)]")}>
                          {relativeDay(l.nextFollowUp)}
                        </span>
                      ) : (
                        <span className="text-[var(--color-dim)]">—</span>
                      )}
                    </td>
                    <td className="text-right tnum text-[var(--color-ink-soft)]">
                      {l.estimatedValue ? fmtCurrency(l.estimatedValue, settings.currency) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-[0.74rem] text-[var(--color-dim)] px-1">
        {filtered.length} of {leads.length} leads
      </p>

      {/* Detail */}
      <Modal
        open={!!view}
        onClose={() => setViewId(null)}
        title={view?.company ?? ""}
        subtitle={view ? `${view.contactName || "—"}${view.contactRole ? ` · ${view.contactRole}` : ""}` : ""}
        size="lg"
        footer={
          view && (
            <>
              <button className="btn" onClick={() => { setLogFor(view); setViewId(null); }}>
                <PhoneCall size={15} /> Log interaction
              </button>
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
            <div className="flex flex-wrap gap-2">
              <Badge tone={leadStatusTone(view.status)}>{view.status}</Badge>
              <Badge tone={qualityTone(view.quality)} dot={false}>{view.quality} quality</Badge>
              <span className="chip">{view.source}</span>
              {view.estimatedValue > 0 && <span className="chip tnum">{fmtCurrency(view.estimatedValue, settings.currency)}</span>}
            </div>

            <div className="flex flex-wrap gap-2">
              {view.email && <a href={`mailto:${view.email}`} className="chip link-accent" onClick={(e) => e.stopPropagation()}><Mail size={12} /> {view.email}</a>}
              {view.phone && <a href={`tel:${view.phone}`} className="chip link-accent"><Phone size={12} /> {view.phone}</a>}
              {view.linkedinUrl && <a href={view.linkedinUrl} target="_blank" rel="noreferrer" className="chip link-accent"><Linkedin size={12} /> LinkedIn <ExternalLink size={11} /></a>}
            </div>

            <DetailGrid>
              <DetailRow label="Industry">{view.industry}</DetailRow>
              <DetailRow label="Company type">{view.companyType}</DetailRow>
              <DetailRow label="Owner">{view.owner}</DetailRow>
              <DetailRow label="Estimated value">{view.estimatedValue ? fmtCurrency(view.estimatedValue, settings.currency) : ""}</DetailRow>
              <DetailRow label="Last contact">{fmtDate(view.lastContact)}</DetailRow>
              <DetailRow label="Next follow-up">{view.nextFollowUp ? `${fmtDate(view.nextFollowUp)} (${relativeDay(view.nextFollowUp)})` : ""}</DetailRow>
              <DetailRow label="Pain point" full>{view.painPoint}</DetailRow>
              <DetailRow label="Objection" full>{view.objection}</DetailRow>
              <DetailRow label="Buying signal" full>{view.buyingSignal}</DetailRow>
              <DetailRow label="Potential solution idea" full>{view.solutionIdea}</DetailRow>
              <DetailRow label="Notes" full>{view.notes}</DetailRow>
            </DetailGrid>
          </div>
        )}
      </Modal>

      {/* Create */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Add Lead" subtitle="Create a new CRM record" size="lg">
        <LeadForm onClose={() => setCreating(false)} />
      </Modal>

      {/* Edit */}
      <Modal open={!!edit} onClose={() => setEditId(null)} title={`Edit — ${edit?.company ?? ""}`} size="lg">
        {edit && <LeadForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>

      {/* Log interaction for a lead */}
      <Modal open={!!logFor} onClose={() => setLogFor(null)} title="Log Interaction" subtitle={logFor?.company}>
        {logFor && <InteractionForm presetLeadId={logFor.id} onClose={() => setLogFor(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) remove("leads", deleteId); setViewId(null); }}
        title="Delete lead?"
        message="This permanently removes the lead from your CRM. This can't be undone."
      />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={null}>
      <LeadsView />
    </Suspense>
  );
}
