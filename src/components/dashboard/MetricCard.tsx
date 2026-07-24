import type { LucideIcon } from "lucide-react";
import { fmtCompact } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
  display,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: boolean;
  hint?: string;
  display?: string;
}) {
  return (
    <div className="panel p-4 hover:border-[var(--color-line-strong)] transition-colors">
      <div className="flex items-start justify-between">
        <span className="text-[0.7rem] font-medium tracking-[0.04em] uppercase text-[var(--color-muted)] leading-tight max-w-[80%]">
          {label}
        </span>
        <Icon
          size={15}
          strokeWidth={1.8}
          className={accent ? "text-[var(--color-accent)]" : "text-[var(--color-dim)]"}
        />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="tnum text-[1.7rem] font-semibold leading-none text-[var(--color-ink)]">
          {display ?? fmtCompact(value)}
        </span>
        {hint && <span className="text-[0.68rem] text-[var(--color-dim)]">{hint}</span>}
      </div>
    </div>
  );
}
