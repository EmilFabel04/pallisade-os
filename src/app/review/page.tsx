"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  Wand2,
  FileDown,
  TrendingUp,
  Trash2,
  AlertTriangle,
  Star,
  CheckCircle2,
  Send,
  Hammer,
  Clock,
  Target,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DictateTextArea } from "@/components/ui/DictateTextArea";
import type { BusinessReview } from "@/lib/types";
import { requestBusinessReview } from "@/lib/aiClient";
import { latestScorecard } from "@/lib/selectors";

export default function ReviewPage() {
  const { scorecards, settings } = useStore();
  const [text, setText] = useState("");
  const [review, setReview] = useState<BusinessReview | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    // Calls Claude Sonnet 4.6 via /api/ai; falls back to the local mock if no key.
    try {
      const result = await requestBusinessReview(text, {
        businessName: settings.businessName,
        services: settings.services,
      });
      setReview(result);
    } finally {
      setLoading(false);
    }
  };

  const loadFromScorecard = () => {
    const sc = latestScorecard(scorecards);
    if (!sc) return;
    const parts = [
      sc.wins && `Wins: ${sc.wins}`,
      sc.problems && `Problems: ${sc.problems}`,
      sc.lessons && `Lessons: ${sc.lessons}`,
      sc.avoidTomorrow && `Avoid tomorrow: ${sc.avoidTomorrow}`,
      `Did ${sc.dials} dials, ${sc.emails} emails, ${sc.linkedinMessages} LinkedIn messages.`,
      `Got ${sc.replies} replies, booked ${sc.meetingsBooked} meetings, created ${sc.leadsCreated} leads.`,
      sc.proposalsSent ? `Sent ${sc.proposalsSent} proposal(s).` : "",
      `${sc.productHours} hours on product/build.`,
    ].filter(Boolean);
    setText(parts.join("\n"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Business Review"
        subtitle="Paste a messy daily brain-dump. Get back a structured read on what mattered, what didn't, and exactly what to do next."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Input */}
        <Panel
          title="Daily update"
          action={
            <button className="btn btn-sm btn-ghost" onClick={loadFromScorecard} disabled={scorecards.length === 0}>
              <Wand2 size={13} /> Pull from scorecard
            </button>
          }
        >
          <DictateTextArea
            rows={14}
            value={text}
            onValueChange={setText}
            placeholder={"Dump everything from today — calls, replies, what worked, what didn't, what you're worried about, what you put off…  (🎙 to talk it out)\n\nThe messier the better. The AI sorts it out."}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[0.72rem] text-[var(--color-dim)]">{text.trim() ? `${text.trim().split(/\s+/).length} words` : "Empty"}</span>
            <button className="btn btn-accent" onClick={generate} disabled={loading || !text.trim()}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Generate review
            </button>
          </div>
        </Panel>

        {/* Output */}
        <div className="space-y-4">
          {!review ? (
            <Panel>
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <Sparkles size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">Your review will appear here</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Write or pull in today&apos;s update, then generate a structured business review with tomorrow&apos;s priorities.
                </p>
              </div>
            </Panel>
          ) : (
            <>
              {/* Priorities — hero */}
              <div className="panel p-5" style={{ borderColor: "var(--color-line-strong)" }}>
                <p className="eyebrow mb-3 inline-flex items-center gap-1.5"><Star size={12} className="text-[var(--color-accent)]" /> Top 3 priorities for tomorrow</p>
                <ol className="space-y-2">
                  {review.topPriorities.map((p, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="tnum flex items-center justify-center text-[0.78rem] font-semibold text-white shrink-0" style={{ width: 24, height: 24, borderRadius: 7, background: "var(--color-accent)" }}>{i + 1}</span>
                      <span className="text-[0.88rem] text-[var(--color-ink)] leading-snug pt-0.5">{p.replace(/^Action:\s*/, "")}</span>
                    </li>
                  ))}
                </ol>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-[var(--color-line)]">
                  <FocusBox icon={Send} label="Outreach focus" value={review.outreachFocus} />
                  <FocusBox icon={Hammer} label="Build focus" value={review.buildFocus} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ReviewList icon={CheckCircle2} title="What happened today" items={review.whatHappened} color="var(--color-ink-soft)" />
                <ReviewList icon={TrendingUp} title="Moved the business forward" items={review.movedForward} color="var(--color-positive)" />
                <ReviewList icon={Star} title="Best opportunities" items={review.bestOpportunities} color="var(--color-accent)" />
                <ReviewList icon={Clock} title="Follow-ups needed" items={review.followUps} color="var(--color-info)" />
                <ReviewList icon={Trash2} title="Wasted time" items={review.wastedTime} color="var(--color-warning)" />
                <ReviewList icon={AlertTriangle} title="Risks" items={review.risks} color="var(--color-accent)" />
              </div>

              <button className="btn w-full" onClick={() => downloadReview(review, settings.businessName)}>
                <FileDown size={15} /> Export review as text
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FocusBox({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <p className="eyebrow mb-1.5 inline-flex items-center gap-1.5"><Icon size={12} className="text-[var(--color-accent)]" /> {label}</p>
      <p className="text-[0.82rem] text-[var(--color-ink-soft)] leading-relaxed">{value}</p>
    </div>
  );
}

function ReviewList({ icon: Icon, title, items, color }: { icon: typeof Target; title: string; items: string[]; color: string }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow mb-2.5 inline-flex items-center gap-1.5"><Icon size={12} style={{ color }} /> {title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-[0.82rem] text-[var(--color-ink-soft)] leading-snug flex gap-2">
            <span style={{ color }}>·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function downloadReview(r: BusinessReview, business: string) {
  const section = (t: string, items: string[]) => `## ${t}\n${items.map((i) => `- ${i}`).join("\n")}\n`;
  const md = [
    `# ${business} — Business Review`,
    section("Top 3 priorities for tomorrow", r.topPriorities),
    `## Outreach focus\n${r.outreachFocus}\n`,
    `## Build focus\n${r.buildFocus}\n`,
    section("What happened today", r.whatHappened),
    section("Moved the business forward", r.movedForward),
    section("Best opportunities", r.bestOpportunities),
    section("Follow-ups needed", r.followUps),
    section("Wasted time", r.wastedTime),
    section("Risks", r.risks),
  ].join("\n");
  const blob = new Blob([md], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "business-review.txt";
  a.click();
  URL.revokeObjectURL(url);
}
