"use client";

import { useMemo, useState } from "react";
import { NotebookPen, Plus, Trash2, Pin, PinOff, Eye, Pencil, Search } from "lucide-react";
import { useStore, useNotes } from "@/lib/store";
import type { Note } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Markdown } from "@/components/advisor/Markdown";
import { DictateTextArea } from "@/components/ui/DictateTextArea";
import { ConfirmDialog } from "@/components/ui/Modal";
import { timeAgo, cn } from "@/lib/utils";

function snippet(body: string): string {
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "No content";
  return line.replace(/^[#\-*\s]+/, "").trim() || "No content";
}

export default function NotebookPage() {
  const store = useStore();
  const notes = useNotes();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [filtered]);

  const active = useMemo<Note | null>(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId],
  );

  const wordCount = active?.body.trim() ? active.body.trim().split(/\s+/).length : 0;

  const createNote = () => {
    const n = store.create("notes", { title: "", body: "", pinned: false });
    setActiveId(n.id);
    setMode("edit");
    setQuery("");
  };

  const deleteActive = () => {
    if (!active) return;
    store.remove("notes", active.id);
    setActiveId(null);
    setConfirmDelete(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notebook"
        subtitle="A quiet space to write, think out loud, and brainstorm. Markdown supported — plain text works too."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
        <Panel title="Notes">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-dim)]"
              />
              <input
                className="input pl-7"
                placeholder="Search notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <button
              className="btn btn-accent btn-sm w-full justify-start"
              onClick={createNote}
            >
              <Plus size={13} /> New note
            </button>

            <div className="flex flex-col gap-1">
              {sorted.map((n) => {
                const isActive = n.id === activeId;
                return (
                  <button
                    key={n.id}
                    onClick={() => setActiveId(n.id)}
                    className={cn(
                      "w-full text-left rounded-lg border px-2.5 py-2 transition-colors",
                      isActive
                        ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                        : "border-transparent hover:bg-[var(--color-surface-2)]",
                    )}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      {n.pinned && (
                        <Pin size={11} className="text-[var(--color-accent)] shrink-0" />
                      )}
                      <span
                        className={cn(
                          "truncate text-[0.83rem]",
                          n.title
                            ? "text-[var(--color-ink)] font-medium"
                            : "text-[var(--color-dim)] italic",
                        )}
                      >
                        {n.title || "Untitled"}
                      </span>
                    </div>
                    <p className="truncate text-[0.72rem] text-[var(--color-dim)] mt-0.5">
                      {snippet(n.body)}
                    </p>
                    <p className="text-[0.7rem] text-[var(--color-dim)] mt-0.5">
                      {timeAgo(n.updatedAt)}
                    </p>
                  </button>
                );
              })}
              {sorted.length === 0 && (
                <p className="text-[0.78rem] text-[var(--color-dim)] px-1 py-2">
                  {query ? "No matches." : "No notes yet."}
                </p>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          {!active ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
              <div
                className="flex items-center justify-center mb-4"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  border: "1px solid var(--color-line-strong)",
                  background: "var(--color-surface-2)",
                }}
              >
                <NotebookPen size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
              </div>
              <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">
                Nothing open
              </h3>
              <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                Pick a note on the left, or start a new one.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-[var(--color-line)] pb-3 mb-3">
                <input
                  className="input flex-1 !text-[0.95rem] font-semibold"
                  placeholder="Untitled"
                  value={active.title}
                  onChange={(e) => store.update("notes", active.id, { title: e.target.value })}
                />
                <button
                  className={cn("btn btn-sm", mode === "edit" && "btn-accent")}
                  onClick={() => setMode("edit")}
                >
                  <Pencil size={12} /> Edit
                </button>
                <button
                  className={cn("btn btn-sm", mode === "preview" && "btn-accent")}
                  onClick={() => setMode("preview")}
                >
                  <Eye size={12} /> Preview
                </button>
                <button
                  className="btn btn-sm"
                  title={active.pinned ? "Unpin" : "Pin"}
                  onClick={() =>
                    store.update("notes", active.id, { pinned: !active.pinned })
                  }
                >
                  {active.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button
                  className="btn btn-sm"
                  title="Delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {mode === "edit" ? (
                <DictateTextArea
                  value={active.body}
                  onValueChange={(v) => store.update("notes", active.id, { body: v })}
                  rows={18}
                  placeholder="Start writing…"
                  autoFocus
                  className="min-h-[420px]"
                />
              ) : (
                <div className="min-h-[420px] overflow-y-auto">
                  <Markdown>{active.body || "*Nothing to preview yet.*"}</Markdown>
                </div>
              )}

              <p className="text-[0.72rem] text-[var(--color-dim)] mt-3">
                {wordCount} words · saved {timeAgo(active.updatedAt)}
              </p>
            </div>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteActive}
        title="Delete note?"
        message="This note will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
