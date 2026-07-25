"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  CalendarCheck,
  Sparkles,
  Quote,
  Target,
  UserPlus,
  FolderKanban,
  PhoneCall,
  ListChecks,
  ArrowUpRight,
  Inbox,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCell } from "@/components/dashboard/StatCell";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import {
  metricView,
  findMetricEntry,
  projectCounts,
  followUps,
  openTasks,
  pipelineCounts,
  pipelineValue,
  recentActivity,
} from "@/lib/selectors";
import { affirmationForDate } from "@/lib/affirmations";
import { bandCellBorders } from "@/lib/statBand";
import { leadStatusTone } from "@/lib/badges";
import { fmtCurrency, fmtDate, relativeDay, timeAgo, todayISO } from "@/lib/utils";
import type { MetricKey } from "@/lib/types";

const ACTIVITY_ICON = {
  lead: UserPlus,
  interaction: PhoneCall,
  project: FolderKanban,
  task: ListChecks,
  scorecard: CalendarCheck,
} as const;

export default function DashboardPage() {
  const { leads, interactions, projects, tasks, scorecards, metricEntries, settings, ready, create, update } =
    useStore();
  const quickAdd = useQuickAdd();

  // One-time continuity seed: carry the existing derived totals into the new
  // editable metrics once the store has hydrated, so nothing looks blank.
  // Ref-guarded + gated on `ready` (never during render) to avoid a Strict-Mode
  // double-create — mirrors src/app/news/page.tsx.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!ready || seededRef.current) return;
    seededRef.current = true;
    const today = todayISO();
    const derived: Record<MetricKey, number> = {
      callsMade: scorecards.reduce((a, s) => a + (s.dials || 0), 0),
      meetingsBooked: scorecards.reduce((a, s) => a + (s.meetingsBooked || 0), 0),
      linkedinPosts: scorecards.reduce((a, s) => a + (s.linkedinPosts || 0), 0),
      cashCollected: scorecards.reduce((a, s) => a + (s.revenueClosed || 0), 0),
    };
    (Object.keys(derived) as MetricKey[]).forEach((key) => {
      const hasAny = metricEntries.some((e) => e.metric === key);
      if (!hasAny && derived[key] > 0) {
        create("metricEntries", { metric: key, date: today, value: derived[key] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const commit = (key: MetricKey, value: number) => {
    const today = todayISO();
    const existing = findMetricEntry(metricEntries, key, today);
    if (existing) update("metricEntries", existing.id, { value });
    else create("metricEntries", { metric: key, date: today, value });
  };

  const calls = metricView(metricEntries, "callsMade");
  const meetings = metricView(metricEntries, "meetingsBooked");
  const linkedin = metricView(metricEntries, "linkedinPosts");
  const cash = metricView(metricEntries, "cashCollected");
  const pc = projectCounts(projects);

  const fus = followUps(leads, tasks);
  const pipeline = pipelineCounts(leads).filter((p) => p.count > 0);
  const maxPipe = Math.max(1, ...pipeline.map((p) => p.count));
  const activity = recentActivity(leads, interactions, projects, tasks, 8);

  // Today's focus — the 3 most pressing things right now
  const focus: { title: string; meta: string; overdue?: boolean; href: string }[] = [];
  for (const f of fus.slice(0, 3))
    focus.push({
      title: f.kind === "lead" ? `Follow up: ${f.title}` : f.title,
      meta: f.overdue
        ? `${relativeDay(f.date)} · ${f.subtitle}`
        : `Due ${relativeDay(f.date).toLowerCase()} · ${f.subtitle}`,
      overdue: f.overdue,
      href: f.kind === "lead" ? `/leads?focus=${f.refId}` : `/tasks?focus=${f.refId}`,
    });
  for (const t of openTasks(tasks)
    .filter((t) => t.priority === "high" && t.category !== "follow-up")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))) {
    if (focus.length >= 3) break;
    focus.push({
      title: t.title,
      meta: `High priority · ${t.dueDate ? relativeDay(t.dueDate).toLowerCase() : "no due date"}`,
      href: `/tasks?focus=${t.id}`,
    });
  }

  // Order is the band's reading order; dividers are derived from the index.
  const stats = [
    { label: "Meetings booked", value: meetings.current, accent: true, editable: true, onCommit: (v: number) => commit("meetingsBooked", v) },
    { label: "Calls made", value: calls.current, editable: true, onCommit: (v: number) => commit("callsMade", v) },
    { label: "LinkedIn posts", value: linkedin.current, editable: true, onCommit: (v: number) => commit("linkedinPosts", v) },
    {
      label: "Cash collected",
      value: cash.current,
      accent: true,
      editable: true,
      display: fmtCurrency(cash.current, settings.currency),
      onCommit: (v: number) => commit("cashCollected", v),
    },
    { label: "Projects built", value: pc.built, accent: true },
    { label: "Projects pitched", value: pc.pitched },
    { label: "Waiting for feedback", value: pc.waiting },
  ];

  const affirmation = affirmationForDate(new Date());
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${settings.founderName || "Emil"}`}
        subtitle={`Here's where ${settings.businessName || "Pallisade Data"} stands today — ${fmtDate(todayISO())}.`}
        actions={
          <>
            <button className="btn" onClick={() => quickAdd.open("scorecard")}>
              <CalendarCheck size={15} /> Log day
            </button>
            <Link href="/review" className="btn btn-accent">
              <Sparkles size={15} /> AI Review
            </Link>
          </>
        }
      />

      {/* Daily affirmation */}
      <div className="panel p-6 flex items-start gap-4">
        <Quote size={22} className="text-[var(--color-accent)] shrink-0 mt-1" />
        <p className="text-[1.15rem] leading-relaxed text-[var(--color-ink)] font-medium">
          {affirmation}
        </p>
      </div>

      {/* Hero stat band — big numbers, no time series */}
      <div className="panel p-0 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 overflow-hidden">
        {stats.map((s, i) => (
          <StatCell key={s.label} {...s} className={bandCellBorders(i + 1, stats.length)} />
        ))}
      </div>

      {/* Working panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's focus */}
        <Panel title="Today's Focus">
          {focus.length === 0 ? (
            <EmptyState
              icon={Target}
              title="Nothing pressing"
              message="No overdue follow-ups or high-priority tasks. Time to create pipeline — add a lead or log some outreach."
              action={
                <button className="btn btn-accent" onClick={() => quickAdd.open("lead")}>
                  <UserPlus size={15} /> Add Lead
                </button>
              }
            />
          ) : (
            <ol className="space-y-2.5">
              {focus.map((f, i) => (
                <li key={i}>
                  <Link
                    href={f.href}
                    className="group flex items-center gap-3.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-3 hover:border-[var(--color-line-strong)] transition-colors"
                  >
                    <span
                      className="tnum flex items-center justify-center text-[0.78rem] font-semibold shrink-0"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        background: f.overdue ? "var(--color-accent)" : "var(--color-surface-3)",
                        color: f.overdue ? "#fff" : "var(--color-muted)",
                        border: f.overdue ? "none" : "1px solid var(--color-line-strong)",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.88rem] text-[var(--color-ink)] truncate">{f.title}</span>
                      <span
                        className={`block text-[0.74rem] truncate ${
                          f.overdue ? "text-[var(--color-accent-soft)]" : "text-[var(--color-muted)]"
                        }`}
                      >
                        {f.meta}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={15}
                      className="text-[var(--color-dim)] group-hover:text-[var(--color-ink)] transition-colors shrink-0"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        {/* Quick links */}
        <Panel title="Quick Links">
          <div className="grid grid-cols-2 gap-2.5">
            <button className="btn justify-start" onClick={() => quickAdd.open("lead")}>
              <UserPlus size={15} /> Add Lead
            </button>
            <button className="btn justify-start" onClick={() => quickAdd.open("project")}>
              <FolderKanban size={15} /> New Project
            </button>
            <Link href="/dial" className="btn justify-start">
              <PhoneCall size={15} /> Log a call
            </Link>
            <Link href="/scorecard" className="btn justify-start">
              <CalendarCheck size={15} /> Daily Scorecard
            </Link>
            <Link href="/review" className="btn justify-start col-span-2">
              <Sparkles size={15} /> AI Review
            </Link>
          </div>
        </Panel>

        {/* Pipeline snapshot */}
        <Panel title="Pipeline Snapshot" href="/leads">
          <div className="mb-4 pb-4 border-b border-[var(--color-line)] flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-1">Open pipeline value</p>
              <p className="tnum text-[1.6rem] font-semibold text-[var(--color-ink)] leading-none">
                {fmtCurrency(pipelineValue(leads), settings.currency)}
              </p>
            </div>
            <p className="tnum text-[0.72rem] text-[var(--color-dim)] shrink-0">{leads.length} leads total</p>
          </div>
          {pipeline.length === 0 ? (
            <p className="text-[0.82rem] text-[var(--color-muted)]">No leads yet.</p>
          ) : (
            <div className="space-y-2.5">
              {pipeline.map((p) => (
                <Link key={p.status} href="/leads" className="block group">
                  <div className="flex items-center justify-between mb-1">
                    <Badge tone={leadStatusTone(p.status)}>{p.status}</Badge>
                    <span className="tnum text-[0.82rem] text-[var(--color-ink-soft)]">{p.count}</span>
                  </div>
                  <div className="h-[3px] rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(p.count / maxPipe) * 100}%`,
                        background: "var(--color-accent)",
                        opacity: 0.55,
                      }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent Activity">
          {activity.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No activity yet"
              message="Start by adding a lead or logging an interaction."
            />
          ) : (
            <ul className="space-y-0.5 -my-1">
              {activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.icon];
                return (
                  <li key={`${a.kind}-${a.id}`} className="flex items-center gap-3 py-2">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-line)",
                      }}
                    >
                      <Icon size={13} className="text-[var(--color-muted)]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.84rem] text-[var(--color-ink-soft)] truncate">{a.title}</span>
                      <span className="block text-[0.72rem] text-[var(--color-dim)] truncate">
                        {a.kind} · {a.subtitle}
                      </span>
                    </span>
                    <span className="text-[0.7rem] text-[var(--color-dim)] tnum shrink-0">{timeAgo(a.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
