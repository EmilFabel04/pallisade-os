"use client";

import { Panel } from "@/components/ui/Panel";
import type { JudgeStats } from "@/lib/gmail/sentAudit";

/** Jev vs. the keyword heuristic, shown only in compare mode. */
export function ComparePanel({ stats }: { stats: JudgeStats }) {
  const total = stats.agreements + stats.disagreements;

  return (
    <Panel title="Judge comparison">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="agree" value={String(stats.agreements)} />
        <Stat label="disagree" value={String(stats.disagreements)} />
        <Stat
          label="agreement"
          value={total === 0 ? "—" : `${Math.round((stats.agreements / total) * 100)}%`}
        />
      </div>
      <p className="mt-3 text-[0.74rem] text-[var(--color-muted)]">
        Jev judged {stats.calls} threads in {(stats.ms / 1000).toFixed(1)}s for{" "}
        {(stats.costUSD * 100).toFixed(2)}¢
        {stats.failures > 0 && ` · ${stats.failures} fell back to the keyword rule`}
      </p>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tnum text-[1.05rem] text-[var(--color-ink)]">{value}</div>
      <div className="text-[0.72rem] text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  );
}
