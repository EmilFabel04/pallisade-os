"use client";

import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Pencil } from "lucide-react";
import { fmtCompact } from "@/lib/utils";
import { Sparkline } from "@/components/ui/Sparkline";

/** A KPI card: label + icon, a value (optionally click-to-edit), and a sparkline. */
export function MetricWidget({
  label,
  value,
  icon: Icon,
  series,
  display,
  accent,
  editable,
  onCommit,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  series: number[];
  display?: string;
  accent?: boolean;
  editable?: boolean;
  onCommit?: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const handledRef = useRef(false);

  const startEdit = () => {
    if (!editable) return;
    setDraft(String(value));
    handledRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (handledRef.current) return;
    handledRef.current = true;
    const n = Number(draft);
    if (Number.isFinite(n) && onCommit) onCommit(Math.max(0, n));
    setEditing(false);
  };
  const cancel = () => {
    handledRef.current = true;
    setEditing(false);
  };

  return (
    <div className="panel p-4 flex flex-col gap-3 hover:border-[var(--color-line-strong)] transition-colors">
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

      <div className="min-h-[2rem] flex items-baseline">
        {editing ? (
          <input
            autoFocus
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            className="input tnum text-[1.5rem] font-semibold leading-none w-full max-w-[8rem] py-0"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={!editable}
            title={editable ? "Click to edit" : undefined}
            className={`group tnum text-[1.7rem] font-semibold leading-none text-[var(--color-ink)] inline-flex items-center gap-1.5 ${
              editable ? "cursor-text hover:text-white" : "cursor-default"
            }`}
          >
            {display ?? fmtCompact(value)}
            {editable && (
              <Pencil
                size={12}
                className="text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )}
          </button>
        )}
      </div>

      <Sparkline data={series} color={accent ? "var(--color-accent)" : "var(--color-muted)"} />
    </div>
  );
}
