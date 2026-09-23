"use client";

import { Mail, Check, Clock, AlertTriangle, PhoneCall, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FollowUp } from "@/lib/gmail/sentScan";

const URGENCY_DOT: Record<string, string> = {
  hot: "bg-[var(--color-accent)]",
  warm: "bg-[var(--color-warning)]",
  low: "bg-[var(--color-muted)]",
  dead: "bg-[var(--color-dim)]",
};

const BUCKET_LABEL: Record<string, string> = {
  no_reply: "no reply",
  awaiting_you: "awaiting you",
  stalled: "stalled",
};

/** One recipient in the follow-up list. Presentational — every action is a
 *  callback, so the page owns all state. */
export function FollowUpRow(props: {
  followUp: FollowUp;
  compare: boolean;
  onOpen: () => void;
  onLog: () => void;
  onTask: () => void;
  onHandled: () => void;
  onSnooze: () => void;
}) {
  const { followUp: f } = props;
  const prob = f.judgement.nudgeProb;

  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", URGENCY_DOT[f.judgement.urgency ?? "low"])}
        title={f.judgement.urgency ?? "unranked"}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[0.85rem] text-[var(--color-ink)]">{f.name}</span>
          <span className="truncate text-[0.74rem] text-[var(--color-dim)]">{f.company}</span>
        </div>
        <div className="truncate text-[0.78rem] text-[var(--color-muted)]">{f.subject}</div>

        {props.compare && f.agrees === false && (
          <div className="mt-1 flex items-center gap-1 text-[0.72rem] text-[var(--color-warning)]">
            <AlertTriangle size={11} />
            disagrees — heuristic said {f.judgement.included ? "skip" : "follow up"}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[0.76rem] text-[var(--color-muted)]">
        <span>{BUCKET_LABEL[f.bucket]}</span>
        <span className="tnum">{f.daysSince}d</span>
        <span className="tnum">{prob == null ? "—" : prob.toFixed(2)}</span>
        <button onClick={props.onOpen} title="Open in inbox" className="hover:text-[var(--color-ink)] transition-colors">
          <Mail size={15} />
        </button>
        <button onClick={props.onLog} title="Log an interaction" className="hover:text-[var(--color-ink)] transition-colors">
          <PhoneCall size={15} />
        </button>
        <button onClick={props.onTask} title="Create a task" className="hover:text-[var(--color-ink)] transition-colors">
          <ListChecks size={15} />
        </button>
        <button onClick={props.onSnooze} title="Snooze 7 days" className="hover:text-[var(--color-ink)] transition-colors">
          <Clock size={15} />
        </button>
        <button onClick={props.onHandled} title="Mark handled" className="hover:text-[var(--color-ink)] transition-colors">
          <Check size={15} />
        </button>
      </div>
    </div>
  );
}
