"use client";

import { useMemo, useState } from "react";
import { ClipboardList, Plus, Pencil, TrendingUp } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { TrendChart, type TrendPoint } from "@/components/ui/TrendChart";
import { ScorecardForm } from "@/components/forms/ScorecardForm";
import type { Scorecard } from "@/lib/types";
import { fmtDate, fmtCurrency, todayISO } from "@/lib/utils";

const CHARTS: { key: keyof Scorecard; label: string; color: string }[] = [
  { key: "dials", label: "Dials over time", color: "#e5484d" },
  { key: "replies", label: "Replies over time", color: "#5b9bd5" },
  { key: "meetingsBooked", label: "Meetings booked over time", color: "#3dd68c" },
  { key: "leadsCreated", label: "Leads created over time", color: "#e3b341" },
  { key: "productHours", label: "Product hours over time", color: "#b66bd6" },
];

export default function ScorecardPage() {
  const { scorecards, settings } = useStore();
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(
    () => [...scorecards].sort((a, b) => a.date.localeCompare(b.date)),
    [scorecards],
  );
  const recent = useMemo(() => sorted.slice(-14), [sorted]);
  const descending = useMemo(() => [...sorted].reverse(), [sorted]);

  const series = (key: keyof Scorecard): TrendPoint[] =>
    recent.map((s) => ({
      label: s.date.slice(5).replace("-", "/"),
      value: Number(s[key]) || 0,
    }));

  const latest = sorted[sorted.length - 1] ?? null;
  const todayCard = scorecards.find((s) => s.date === todayISO());
  const edit = scorecards.find((s) => s.id === editId) ?? null;

  const totalRevenue = scorecards.reduce((s, c) => s + (c.revenueClosed || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Scorecard"
        subtitle="Log the numbers every day. Consistency compounds — the charts keep you honest."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> {todayCard ? "Edit today" : "Log today"}
          </button>
        }
      />

      {scorecards.length === 0 ? (
        <Panel noPad>
          <EmptyState
            icon={ClipboardList}
            title="No scorecards yet"
            message="Log your first day to start tracking dials, replies, meetings and build hours over time."
            action={<button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Log today</button>}
          />
        </Panel>
      ) : (
        <>
          {/* Quick totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TotalStat label="Days logged" value={String(scorecards.length)} />
            <TotalStat label="Revenue closed (all-time)" value={fmtCurrency(totalRevenue, settings.currency)} accent />
            <TotalStat label="Dials today" value={String(todayCard?.dials ?? 0)} />
            <TotalStat label="Build hours today" value={String(todayCard?.productHours ?? 0)} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {CHARTS.map((c) => {
              const data = series(c.key);
              const last = data[data.length - 1]?.value ?? 0;
              return (
                <Panel key={c.key as string} title={c.label} action={
                  <span className="inline-flex items-center gap-1.5 tnum text-[0.8rem] text-[var(--color-ink-soft)]">
                    <TrendingUp size={13} style={{ color: c.color }} /> {last}
                  </span>
                }>
                  <TrendChart data={data} type={c.key === "dials" ? "bar" : "line"} color={c.color} height={150} />
                </Panel>
              );
            })}

            {/* Latest reflection */}
            {latest && (
              <Panel title="Latest reflection" action={
                <button className="btn btn-sm btn-ghost" onClick={() => setEditId(latest.id)}><Pencil size={13} /> Edit</button>
              }>
                <p className="eyebrow mb-3">{fmtDate(latest.date)}</p>
                <div className="space-y-3">
                  <Reflect label="Wins" value={latest.wins} tone="positive" />
                  <Reflect label="Problems" value={latest.problems} tone="accent" />
                  <Reflect label="Lessons" value={latest.lessons} tone="info" />
                  <Reflect label="Avoid tomorrow" value={latest.avoidTomorrow} tone="warning" />
                </div>
              </Panel>
            )}
          </div>

          {/* History table */}
          <Panel title="History" noPad>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Dials</th>
                    <th className="text-right">Emails</th>
                    <th className="text-right">LinkedIn</th>
                    <th className="text-right">Replies</th>
                    <th className="text-right">Meetings</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Build hrs</th>
                    <th className="text-right">Revenue</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {descending.map((s) => (
                    <tr key={s.id} onClick={() => setEditId(s.id)}>
                      <td className="font-medium text-[var(--color-ink)] whitespace-nowrap">{fmtDate(s.date)}</td>
                      <td className="text-right tnum">{s.dials}</td>
                      <td className="text-right tnum">{s.emails}</td>
                      <td className="text-right tnum">{s.linkedinMessages}</td>
                      <td className="text-right tnum">{s.replies}</td>
                      <td className="text-right tnum">{s.meetingsBooked}</td>
                      <td className="text-right tnum">{s.leadsCreated}</td>
                      <td className="text-right tnum">{s.productHours}</td>
                      <td className="text-right tnum">{s.revenueClosed ? fmtCurrency(s.revenueClosed, settings.currency) : "—"}</td>
                      <td className="text-right"><Pencil size={13} className="text-[var(--color-dim)] inline" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Daily Scorecard" subtitle="Log today's activity" size="lg">
        <ScorecardForm initial={todayCard} onClose={() => setCreating(false)} />
      </Modal>
      <Modal open={!!edit} onClose={() => setEditId(null)} title={`Scorecard — ${edit ? fmtDate(edit.date) : ""}`} size="lg">
        {edit && <ScorecardForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>
    </div>
  );
}

function TotalStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel p-4">
      <p className="text-[0.7rem] uppercase tracking-[0.04em] text-[var(--color-muted)]">{label}</p>
      <p className={`tnum text-[1.5rem] font-semibold mt-1.5 ${accent ? "text-[var(--color-accent-soft)]" : "text-[var(--color-ink)]"}`}>{value}</p>
    </div>
  );
}

function Reflect({ label, value, tone }: { label: string; value: string; tone: "positive" | "accent" | "info" | "warning" }) {
  const color = tone === "positive" ? "var(--color-positive)" : tone === "accent" ? "var(--color-accent)" : tone === "info" ? "var(--color-info)" : "var(--color-warning)";
  return (
    <div className="flex gap-3">
      <span className="w-1 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0">
        <p className="eyebrow mb-0.5" style={{ color }}>{label}</p>
        <p className="text-[0.83rem] text-[var(--color-ink-soft)] leading-relaxed">{value || <span className="text-[var(--color-dim)]">—</span>}</p>
      </div>
    </div>
  );
}
