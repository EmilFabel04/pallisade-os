"use client";

import Link from "next/link";
import {
  Phone,
  Mail,
  Linkedin,
  MessageSquare,
  CalendarCheck,
  UserPlus,
  FolderKanban,
  Clock,
  Target,
  Sparkles,
  ArrowUpRight,
  CircleDot,
  PhoneCall,
  ListChecks,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import {
  dashboardMetrics,
  followUps,
  pipelineCounts,
  pipelineValue,
  recentActivity,
  openTasks,
  latestScorecard,
} from "@/lib/selectors";
import { generateTomorrowPlan } from "@/lib/ai";
import { leadStatusTone } from "@/lib/badges";
import { fmtCurrency, fmtDate, relativeDay, timeAgo, todayISO } from "@/lib/utils";

const ACTIVITY_ICON = {
  lead: UserPlus,
  interaction: PhoneCall,
  project: FolderKanban,
  task: ListChecks,
  scorecard: CalendarCheck,
} as const;

export default function DashboardPage() {
  const { leads, interactions, projects, tasks, scorecards, settings } = useStore();
  const quickAdd = useQuickAdd();

  const m = dashboardMetrics(leads, projects, tasks, scorecards);
  const fus = followUps(leads, tasks);
  const pipeline = pipelineCounts(leads).filter((p) => p.count > 0);
  const activity = recentActivity(leads, interactions, projects, tasks, 8);
  const tomorrow = generateTomorrowPlan({
    scorecard: latestScorecard(scorecards),
    openTasks: openTasks(tasks),
    dueFollowUps: fus.length,
  });

  // Today's focus — the 3 most pressing things right now
  const focus: { title: string; meta: string; overdue?: boolean; href: string }[] = [];
  for (const f of fus.slice(0, 3))
    focus.push({
      title: f.kind === "lead" ? `Follow up: ${f.title}` : f.title,
      meta: f.overdue ? `${relativeDay(f.date)} · ${f.subtitle}` : `Due ${relativeDay(f.date).toLowerCase()} · ${f.subtitle}`,
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

  const maxPipe = Math.max(1, ...pipeline.map((p) => p.count));
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

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Dials made" value={m.dials} icon={Phone} accent />
        <MetricCard label="Emails sent" value={m.emails} icon={Mail} />
        <MetricCard label="LinkedIn sent" value={m.linkedinMessages} icon={Linkedin} />
        <MetricCard label="Replies received" value={m.replies} icon={MessageSquare} />
        <MetricCard label="Calls booked" value={m.callsBooked} icon={CalendarCheck} accent />
        <MetricCard label="Leads created" value={m.leadsCreatedToday} icon={UserPlus} />
        <MetricCard label="Active projects" value={m.activeProjects} icon={FolderKanban} />
        <MetricCard label="Follow-ups due" value={m.followUpsDue} icon={Clock} accent />
      </div>

      {/* Focus + tomorrow + pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
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
                        <span className={`block text-[0.74rem] truncate ${f.overdue ? "text-[var(--color-accent-soft)]" : "text-[var(--color-muted)]"}`}>
                          {f.meta}
                        </span>
                      </span>
                      <ArrowUpRight size={15} className="text-[var(--color-dim)] group-hover:text-[var(--color-ink)] transition-colors shrink-0" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {/* Tomorrow plan */}
          <Panel
            title="Tomorrow Plan"
            action={<span className="inline-flex items-center gap-1.5 text-[0.7rem] text-[var(--color-dim)]"><Sparkles size={12} className="text-[var(--color-accent)]" /> AI-generated</span>}
          >
            <div className="space-y-3">
              <div>
                <p className="eyebrow mb-2">Top 3 priorities</p>
                <ul className="space-y-1.5">
                  {tomorrow.priorities.map((p, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[0.85rem] text-[var(--color-ink-soft)]">
                      <CircleDot size={14} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
                  <p className="eyebrow mb-1.5">Outreach focus</p>
                  <p className="text-[0.82rem] text-[var(--color-ink-soft)] leading-relaxed">{tomorrow.outreachFocus}</p>
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
                  <p className="eyebrow mb-1.5">Build focus</p>
                  <p className="text-[0.82rem] text-[var(--color-ink-soft)] leading-relaxed">{tomorrow.buildFocus}</p>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Pipeline snapshot */}
        <Panel title="Pipeline Snapshot" href="/leads">
          <div className="mb-4 pb-4 border-b border-[var(--color-line)]">
            <p className="eyebrow mb-1">Open pipeline value</p>
            <p className="tnum text-[1.6rem] font-semibold text-[var(--color-ink)]">
              {fmtCurrency(pipelineValue(leads), settings.currency)}
            </p>
            <p className="text-[0.72rem] text-[var(--color-dim)] mt-0.5">{leads.length} leads total</p>
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
      </div>

      {/* Follow-ups + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Follow-ups Due" href="/leads">
          {fus.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="All caught up"
              message="No follow-ups due today. Your pipeline is current."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)] -my-1">
              {fus.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <Link
                    href={f.kind === "lead" ? `/leads?focus=${f.refId}` : `/tasks?focus=${f.refId}`}
                    className="flex items-center gap-3 py-2.5 group"
                  >
                    {f.overdue ? (
                      <AlertTriangle size={15} className="text-[var(--color-accent)] shrink-0" />
                    ) : (
                      <Clock size={15} className="text-[var(--color-muted)] shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.85rem] text-[var(--color-ink)] group-hover:text-white truncate">{f.title}</span>
                      <span className="block text-[0.73rem] text-[var(--color-muted)] truncate">{f.subtitle}</span>
                    </span>
                    <span className={`text-[0.74rem] tnum shrink-0 ${f.overdue ? "text-[var(--color-accent-soft)]" : "text-[var(--color-muted)]"}`}>
                      {relativeDay(f.date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent Activity">
          {activity.length === 0 ? (
            <EmptyState icon={Inbox} title="No activity yet" message="Start by adding a lead or logging an interaction." />
          ) : (
            <ul className="space-y-0.5 -my-1">
              {activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.icon];
                return (
                  <li key={`${a.kind}-${a.id}`} className="flex items-center gap-3 py-2">
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 28, height: 28, borderRadius: 8, background: "var(--color-surface-2)", border: "1px solid var(--color-line)" }}
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
