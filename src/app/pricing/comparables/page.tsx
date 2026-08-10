"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Library, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import {
  Field, FormGrid, NumberInput, Select, TextArea, TextInput,
} from "@/components/ui/Field";
import { useComparables, useLeads, useQuotes, useSettings, useStore } from "@/lib/store";
import {
  AI_DEPTHS, BUILD_STATUSES, COMPARABLE_KINDS, SUPPORT_LOADS,
  type AiDepth, type BuildStatus, type Comparable, type ComparableKind, type SupportLoad,
} from "@/lib/types";
import { fmtCurrency } from "@/lib/utils";

type ComparableDraft = Omit<Comparable, "id" | "createdAt" | "updatedAt">;

const BLANK: ComparableDraft = {
  kind: "market" as ComparableKind,
  name: "",
  notes: "",
  sourceUrl: "",
  attributes: {
    buildStatus: "new" as BuildStatus,
    surfaces: 1,
    integrations: [] as string[],
    dataSources: 1,
    aiDepth: "none" as AiDepth,
    userCount: 1,
    supportLoad: "low" as SupportLoad,
  },
  setupPrice: 0,
  monthlyPrice: 0,
  currency: "ZAR",
};

export default function ComparablesPage() {
  const comparables = useComparables();
  const quotes = useQuotes();
  const leads = useLeads();
  const settings = useSettings();
  const { create, remove } = useStore();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ComparableDraft>(BLANK);

  const ownDeals = useMemo(
    () =>
      quotes
        .filter((q) => q.status === "won" || q.status === "lost")
        .map((q) => ({
          id: q.id,
          name: q.name,
          company: leads.find((l) => l.id === q.leadId)?.company ?? "—",
          status: q.status,
          lostReason: q.lostReason,
          setup: q.status === "won" ? q.closedSetup : q.sentSetup,
          monthly: q.status === "won" ? q.closedMonthly : q.sentMonthly,
        })),
    [quotes, leads],
  );

  function save() {
    if (!draft.name.trim()) return;
    create("comparables", draft);
    setDraft(BLANK);
    setAdding(false);
  }

  return (
    <>
      <PageHeader
        title="Comparables"
        subtitle="What similar solutions cost. This is the evidence every setup fee is argued from."
        actions={
          <>
            <Link href="/pricing" className="btn btn-ghost">
              <ArrowLeft size={15} /> Quotes
            </Link>
            <button className="btn btn-accent" onClick={() => setAdding((v) => !v)}>
              <Plus size={15} /> Add comparable
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {adding && (
          <Panel title="New comparable">
            <FormGrid>
              <Field label="Kind" hint="Market: what a vendor charges. Reference: an anchor you authored.">
                <Select
                  options={COMPARABLE_KINDS}
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as ComparableKind })}
                />
              </Field>
              <Field label="Name">
                <TextInput
                  value={draft.name}
                  placeholder="Vendor X reporting suite"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Setup price">
                <NumberInput
                  value={draft.setupPrice}
                  min={0}
                  onChange={(e) => setDraft({ ...draft, setupPrice: Number(e.target.value) })}
                />
              </Field>
              <Field label="Monthly price">
                <NumberInput
                  value={draft.monthlyPrice}
                  min={0}
                  onChange={(e) => setDraft({ ...draft, monthlyPrice: Number(e.target.value) })}
                />
              </Field>
              <Field label="Currency" hint="USD entries need the FX rate set in Settings, or they are excluded.">
                <Select
                  options={["ZAR", "USD"] as const}
                  value={draft.currency}
                  onChange={(e) =>
                    setDraft({ ...draft, currency: e.target.value as "ZAR" | "USD" })
                  }
                />
              </Field>
              <Field label="Source URL">
                <TextInput
                  value={draft.sourceUrl}
                  onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                />
              </Field>
              <Field label="Surfaces">
                <NumberInput
                  value={draft.attributes.surfaces}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, surfaces: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Data sources">
                <NumberInput
                  value={draft.attributes.dataSources}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, dataSources: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Integrations" hint="Comma separated.">
                <TextInput
                  value={draft.attributes.integrations.join(", ")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: {
                        ...draft.attributes,
                        integrations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="AI depth">
                <Select
                  options={AI_DEPTHS}
                  value={draft.attributes.aiDepth}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, aiDepth: e.target.value as AiDepth },
                    })
                  }
                />
              </Field>
              <Field label="Users">
                <NumberInput
                  value={draft.attributes.userCount}
                  min={0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, userCount: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              <Field label="Support load">
                <Select
                  options={SUPPORT_LOADS}
                  value={draft.attributes.supportLoad}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, supportLoad: e.target.value as SupportLoad },
                    })
                  }
                />
              </Field>
              <Field label="Build status">
                <Select
                  options={BUILD_STATUSES}
                  value={draft.attributes.buildStatus}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attributes: { ...draft.attributes, buildStatus: e.target.value as BuildStatus },
                    })
                  }
                />
              </Field>
            </FormGrid>
            <Field label="Notes" className="mt-3.5">
              <TextArea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Where you saw this, and anything that qualifies the number."
              />
            </Field>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-accent" onClick={save} disabled={!draft.name.trim()}>
                Save
              </button>
            </div>
          </Panel>
        )}

        <Panel title={`Market examples and reference builds (${comparables.length})`} noPad>
          {comparables.length === 0 ? (
            <EmptyState
              icon={Library}
              title="No comparables yet"
              message="Three similar examples is the minimum before a setup fee can be anchored at all."
            />
          ) : (
            <table className="w-full text-[0.84rem]">
              <thead>
                <tr className="text-[var(--color-dim)] text-left">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium text-right">Setup</th>
                  <th className="px-4 py-2 font-medium text-right">Monthly</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {comparables.map((c: Comparable) => (
                  <tr key={c.id} className="border-t border-[var(--color-line)]">
                    <td className="px-4 py-2.5">
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-[var(--color-line-strong)]">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={c.kind === "market" ? "info" : "neutral"}>{c.kind}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tnum">
                      {fmtCurrency(c.setupPrice, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tnum">
                      {fmtCurrency(c.monthlyPrice, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="btn btn-ghost btn-icon"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => remove("comparables", c.id)}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={`Your own closed deals (${ownDeals.length})`} noPad>
          {ownDeals.length === 0 ? (
            <EmptyState
              icon={Library}
              title="No closed deals yet"
              message="Mark a quote won or lost and it appears here automatically — the strongest evidence you have."
            />
          ) : (
            <>
              <table className="w-full text-[0.84rem]">
                <thead>
                  <tr className="text-[var(--color-dim)] text-left">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Quote</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 font-medium text-right">Setup</th>
                    <th className="px-4 py-2 font-medium text-right">Monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {ownDeals.map((d) => (
                    <tr key={d.id} className="border-t border-[var(--color-line)]">
                      <td className="px-4 py-2.5">{d.company}</td>
                      <td className="px-4 py-2.5 text-[var(--color-muted)]">{d.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={d.status === "won" ? "positive" : "muted"}>
                          {d.status === "lost" && d.lostReason ? `lost · ${d.lostReason}` : d.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {fmtCurrency(d.setup, settings.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {fmtCurrency(d.monthly, settings.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-[0.75rem] text-[var(--color-dim)] leading-relaxed border-t border-[var(--color-line)]">
                Read-only — these are derived from your quotes. Wins anchor the range; only a
                loss recorded as a price loss caps the stretch.
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
