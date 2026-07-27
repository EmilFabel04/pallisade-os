"use client";

import { useMemo, useState } from "react";
import { Plus, MessageSquare, Search } from "lucide-react";
import { searchThreads } from "@/lib/advisor/searchThreads";
import type { Conversation } from "@/lib/types";

/** "3 matches" / "1 match" / "title match" for a row's sub-line. */
function matchLabel(count: number): string {
  if (count === 0) return "title match";
  return count === 1 ? "1 match" : `${count} matches`;
}

export function ThreadList({
  conversations, activeId, onSelect, onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations],
  );
  const results = useMemo(() => searchThreads(sorted, query), [sorted, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-2">
      {conversations.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search…"
            className="input"
            style={{ paddingLeft: "1.9rem", height: 32, fontSize: "0.78rem" }}
          />
        </div>
      )}

      <button className="btn btn-sm w-full justify-start" onClick={onNew}>
        <Plus size={14} /> New conversation
      </button>

      <div className="flex flex-col gap-0.5 mt-1 overflow-y-auto">
        {results.map(({ thread: c, matchCount }) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="flex items-start gap-2 rounded-md px-2.5 py-2 text-left text-[0.8rem]"
              style={{
                background: active ? "var(--color-surface-2)" : "transparent",
                color: active ? "var(--color-ink)" : "var(--color-muted)",
                border: `1px solid ${active ? "var(--color-line)" : "transparent"}`,
              }}
            >
              <MessageSquare size={13} className="shrink-0 text-[var(--color-dim)] mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.title || "Untitled"}</span>
                {searching && (
                  <span className="block text-[0.68rem] text-[var(--color-dim)] mt-0.5">
                    {matchLabel(matchCount)}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {conversations.length === 0 && (
          <p className="text-[0.75rem] text-[var(--color-dim)] px-2.5 py-2">No conversations yet.</p>
        )}
        {conversations.length > 0 && results.length === 0 && (
          <p className="text-[0.75rem] text-[var(--color-dim)] px-2.5 py-2">
            No threads match “{query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
