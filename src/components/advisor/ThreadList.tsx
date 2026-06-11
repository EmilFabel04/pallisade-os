"use client";

import { Plus, MessageSquare } from "lucide-react";
import type { Conversation } from "@/lib/types";

export function ThreadList({
  conversations, activeId, onSelect, onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="flex flex-col gap-2">
      <button className="btn btn-sm w-full justify-start" onClick={onNew}>
        <Plus size={14} /> New conversation
      </button>
      <div className="flex flex-col gap-0.5 mt-1 overflow-y-auto">
        {sorted.map((c) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.8rem] truncate"
              style={{
                background: active ? "var(--color-surface-2)" : "transparent",
                color: active ? "var(--color-ink)" : "var(--color-muted)",
                border: `1px solid ${active ? "var(--color-line)" : "transparent"}`,
              }}
            >
              <MessageSquare size={13} className="shrink-0 text-[var(--color-dim)]" />
              <span className="truncate">{c.title || "Untitled"}</span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-[0.75rem] text-[var(--color-dim)] px-2.5 py-2">No conversations yet.</p>
        )}
      </div>
    </div>
  );
}
