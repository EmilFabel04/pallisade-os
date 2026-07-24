"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  CalendarCheck,
  Phone,
  Linkedin,
  Hammer,
  Send,
  Clock,
  Banknote,
  Sparkles,
  Quote,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricWidget } from "@/components/dashboard/MetricWidget";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import {
  metricView,
  findMetricEntry,
  projectCounts,
  projectSeries,
} from "@/lib/selectors";
import { affirmationForDate } from "@/lib/affirmations";
import { fmtCurrency, todayISO } from "@/lib/utils";
import type { MetricKey } from "@/lib/types";

export default function DashboardPage() {
  const { projects, scorecards, metricEntries, settings, ready, create, update } = useStore();
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

  const vals = (s: { value: number }[]) => s.map((p) => p.value);
  const affirmation = affirmationForDate(new Date());
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${settings.founderName || "Emil"}`}
        subtitle={`${settings.businessName || "Pallisade Data"} — all time`}
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

      {/* Editable + derived progress widgets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricWidget
          label="Meetings booked"
          value={meetings.current}
          icon={CalendarCheck}
          accent
          editable
          series={vals(meetings.series)}
          onCommit={(v) => commit("meetingsBooked", v)}
        />
        <MetricWidget
          label="Calls made"
          value={calls.current}
          icon={Phone}
          editable
          series={vals(calls.series)}
          onCommit={(v) => commit("callsMade", v)}
        />
        <MetricWidget
          label="LinkedIn posts"
          value={linkedin.current}
          icon={Linkedin}
          editable
          series={vals(linkedin.series)}
          onCommit={(v) => commit("linkedinPosts", v)}
        />
        <MetricWidget
          label="Cash collected"
          value={cash.current}
          icon={Banknote}
          accent
          editable
          display={fmtCurrency(cash.current, settings.currency)}
          series={vals(cash.series)}
          onCommit={(v) => commit("cashCollected", v)}
        />
        <MetricWidget
          label="Projects built"
          value={pc.built}
          icon={Hammer}
          accent
          series={vals(projectSeries(projects, "built"))}
        />
        <MetricWidget
          label="Projects pitched"
          value={pc.pitched}
          icon={Send}
          series={vals(projectSeries(projects, "pitched"))}
        />
        <MetricWidget
          label="Waiting for feedback"
          value={pc.waiting}
          icon={Clock}
          series={vals(projectSeries(projects, "waiting"))}
        />
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
