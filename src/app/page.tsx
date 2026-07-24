"use client";

import Link from "next/link";
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
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import { allTimeMetrics } from "@/lib/selectors";
import { affirmationForDate } from "@/lib/affirmations";
import { fmtCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const { projects, scorecards, settings } = useStore();
  const quickAdd = useQuickAdd();

  const m = allTimeMetrics(scorecards, projects);
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

      {/* All-time progress */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Meetings booked" value={m.meetingsBooked} icon={CalendarCheck} accent />
        <MetricCard label="Calls made" value={m.callsMade} icon={Phone} />
        <MetricCard label="LinkedIn posts" value={m.linkedinPosts} icon={Linkedin} />
        <MetricCard label="Projects built" value={m.projectsBuilt} icon={Hammer} accent />
        <MetricCard label="Projects pitched" value={m.projectsPitched} icon={Send} />
        <MetricCard label="Waiting for feedback" value={m.waitingForFeedback} icon={Clock} />
        <MetricCard
          label="Cash collected"
          value={m.cashCollected}
          icon={Banknote}
          display={fmtCurrency(m.cashCollected, settings.currency)}
          accent
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
