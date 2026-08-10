"use client";

import { useMemo, useState } from "react";
import { Calculator, Plus, Library } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput } from "@/components/ui/Field";
import { FilterSelect } from "@/components/ui/Detail";
import { QuoteDetail } from "@/components/pricing/QuoteDetail";
import { useLeads, useQuotes, useSettings, useStore } from "@/lib/store";
import { QUOTE_STATUSES, type Quote } from "@/lib/types";
import { quoteStatusTone } from "@/lib/badges";
import { fmtCurrency, timeAgo } from "@/lib/utils";

const BLANK_ATTRS = {
  buildStatus: "new" as const,
  surfaces: 1,
  integrations: [] as string[],
  dataSources: 1,
  aiDepth: "none" as const,
  userCount: 1,
  supportLoad: "low" as const,
};

export default function PricingPage() {
  const quotes = useQuotes();
  const leads = useLeads();
  const settings = useSettings();
  const { create } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [newLeadId, setNewLeadId] = useState("");
  const [newName, setNewName] = useState("");

  const companyFor = useMemo(
    () => (q: Quote) => leads.find((l) => l.id === q.leadId)?.company ?? "—",
    [leads],
  );

  const visible = useMemo(
    () =>
      quotes.filter((q) => statusFilter === "all" || q.status === statusFilter),
    [quotes, statusFilter],
  );

  const selected = quotes.find((q) => q.id === selectedId) ?? null;

  function createQuote() {
    if (!newLeadId) return;
    const lead = leads.find((l) => l.id === newLeadId);
    const quote = create("quotes", {
      leadId: newLeadId,
      name: newName.trim() || `${lead?.company ?? "New"} build`,
      attributes: BLANK_ATTRS,
      opexLines: [],
      aiUsage: null,
      intent: null,
      capex: null,
      band: null,
      status: "draft",
      sentSetup: 0,
      sentMonthly: 0,
      closedSetup: 0,
      closedMonthly: 0,
      lostReason: "",
      notes: "",
    });
    setAdding(false);
    setNewLeadId("");
    setNewName("");
    setSelectedId(quote.id);
  }

  if (selected) {
    return <QuoteDetail quote={selected} onClose={() => setSelectedId(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Pricing"
        subtitle="What a deal is worth, argued from comparable solutions and what this client can actually spend."
        actions={
          <>
            <Link href="/pricing/comparables" className="btn btn-ghost">
              <Library size={15} /> Comparables
            </Link>
            <button className="btn btn-accent" onClick={() => setAdding(true)}>
              <Plus size={15} /> New quote
            </button>
          </>
        }
      />

      <Panel
        title={`Quotes (${visible.length})`}
        action={
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All" },
              ...QUOTE_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
        }
        noPad
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title="No quotes yet"
            message="A quote starts from a lead — that is what the intent read scores against."
            action={
              <button className="btn btn-accent" onClick={() => setAdding(true)}>
                <Plus size={15} /> New quote
              </button>
            }
          />
        ) : (
          <table className="w-full text-[0.84rem]">
            <thead>
              <tr className="text-[var(--color-dim)] text-left">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Quote</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Setup</th>
                <th className="px-4 py-2 font-medium text-right">Monthly</th>
                <th className="px-4 py-2 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q) => (
                <tr
                  key={q.id}
                  className="border-t border-[var(--color-line)] hover:bg-[var(--color-surface-2)] cursor-pointer"
                  onClick={() => setSelectedId(q.id)}
                >
                  <td className="px-4 py-2.5">{companyFor(q)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">{q.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={quoteStatusTone(q.status)}>{q.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {q.band?.setup ? fmtCurrency(q.band.setup.target, settings.currency) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {q.band ? fmtCurrency(q.band.monthly.target, settings.currency) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-dim)]">
                    {timeAgo(q.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Modal open={adding} onClose={() => setAdding(false)} title="New quote">
        <div className="flex flex-col gap-3.5">
          <Field
            label="Lead"
            hint="Required — the intent read scores this client's own words."
          >
            <select
              className="select"
              value={newLeadId}
              onChange={(e) => setNewLeadId(e.target.value)}
            >
              <option value="">Choose a lead…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company} — {l.contactName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name" hint="Optional. Defaults to the company plus 'build'.">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Investor reporting build"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-accent" onClick={createQuote} disabled={!newLeadId}>
              Create
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
