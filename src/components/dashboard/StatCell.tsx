"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { startEdit, setDraft, commit, cancel, type EditState } from "@/lib/inlineEdit";
import { cn } from "@/lib/utils";

const IDLE: EditState = { editing: false, draft: "", handled: true };

/**
 * One stat inside the hero band: a big value + small label, click-to-edit when
 * `editable`. All commit/cancel sequencing lives in `@/lib/inlineEdit` so it can
 * be tested without a DOM.
 */
export function StatCell({
  label,
  value,
  display,
  accent,
  editable,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  display?: string;
  accent?: boolean;
  editable?: boolean;
  onCommit?: (value: number) => void;
  /** Divider borders for this cell's position — see `bandCellBorders`. */
  className?: string;
}) {
  const [edit, setEdit] = useState<EditState>(IDLE);

  const begin = () => {
    if (!editable) return;
    setEdit(startEdit(value));
  };
  const resolve = () => {
    const { state, value: next } = commit(edit);
    setEdit(state);
    if (next !== null) onCommit?.(next);
  };

  const valueColor = accent ? "text-[var(--color-accent)]" : "text-[var(--color-ink)]";

  return (
    <div className={cn("px-5 py-6 border-[var(--color-line)]", className)}>
      {/* Fixed-height value row so entering edit mode never shifts the band. */}
      <div className="h-[2.4rem] flex items-center">
        {edit.editing ? (
          <input
            autoFocus
            type="number"
            min={0}
            value={edit.draft}
            onChange={(e) => setEdit(setDraft(edit, e.target.value))}
            onBlur={resolve}
            onKeyDown={(e) => {
              if (e.key === "Enter") resolve();
              else if (e.key === "Escape") setEdit(cancel(edit));
            }}
            className={`input tnum w-full h-full text-[1.9rem] font-semibold leading-none py-0 ${valueColor}`}
          />
        ) : (
          <button
            type="button"
            onClick={begin}
            disabled={!editable}
            title={editable ? "Click to edit" : undefined}
            className={`group tnum text-[1.9rem] font-semibold leading-none inline-flex items-center gap-1.5 ${valueColor} ${
              editable ? "cursor-text hover:opacity-80 transition-opacity" : "cursor-default"
            }`}
          >
            {display ?? value.toLocaleString()}
            {editable && (
              <Pencil
                size={12}
                className="text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              />
            )}
          </button>
        )}
      </div>
      <p className="mt-2 text-[0.7rem] font-medium tracking-[0.04em] uppercase text-[var(--color-muted)] leading-tight">
        {label}
      </p>
    </div>
  );
}
