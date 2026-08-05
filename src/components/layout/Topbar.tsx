"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search, Plus, UserPlus, PhoneCall, ListChecks, FolderKanban, ClipboardList, CornerDownLeft } from "lucide-react";
import { useStore, type SearchHit } from "@/lib/store";
import { useQuickAdd, type QuickAddKind } from "@/components/forms/QuickAdd";

const HIT_ROUTE: Record<SearchHit["kind"], string> = {
  leads: "/leads",
  interactions: "/interactions",
  projects: "/projects",
  tasks: "/tasks",
  scorecards: "/scorecard",
  painPoints: "/pain-bank",
  conversations: "/advisor",
  playbooks: "/prep",
  targets: "/targets",
  dialLists: "/dial",
  positioningProfiles: "/content",
  voiceSamples: "/content",
  voiceProfile: "/content",
  contentThreads: "/content",
  brainThreads: "/brain",
  newsFeed: "/news",
  newsInterests: "/news",
  newsBookmarks: "/news",
  notes: "/notebook",
  milestones: "/projects",
  projectThreads: "/projects",
};

const HIT_LABEL: Record<SearchHit["kind"], string> = {
  leads: "Lead",
  interactions: "Interaction",
  projects: "Project",
  tasks: "Task",
  scorecards: "Scorecard",
  painPoints: "Pain point",
  conversations: "Conversation",
  playbooks: "Playbook",
  targets: "Target",
  dialLists: "Dial List",
  positioningProfiles: "Positioning Profile",
  voiceSamples: "Voice Sample",
  voiceProfile: "Voice Profile",
  contentThreads: "Content Thread",
  brainThreads: "Brain Thread",
  newsFeed: "News Feed",
  newsInterests: "News Interests",
  newsBookmarks: "News Bookmark",
  notes: "Note",
  milestones: "Milestone",
  projectThreads: "Project Thread",
};

const QUICK_ACTIONS: { kind: NonNullable<QuickAddKind>; label: string; icon: typeof Plus }[] = [
  { kind: "lead", label: "Add Lead", icon: UserPlus },
  { kind: "interaction", label: "Log Call", icon: PhoneCall },
  { kind: "task", label: "Add Task", icon: ListChecks },
  { kind: "project", label: "Add Project", icon: FolderKanban },
  { kind: "scorecard", label: "Add Daily Scorecard", icon: ClipboardList },
];

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { search } = useStore();
  const quickAdd = useQuickAdd();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const results = q.trim().length >= 2 ? search(q) : [];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (hit: SearchHit) => {
    setSearchOpen(false);
    setQ("");
    router.push(`${HIT_ROUTE[hit.kind]}?focus=${hit.id}`);
  };

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center gap-3 px-4 sm:px-6 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-canvas)_82%,transparent)] backdrop-blur-md">
      <button className="btn btn-ghost btn-icon md:hidden" onClick={onMenu} aria-label="Menu">
        <Menu size={18} />
      </button>

      {/* Search */}
      <div ref={searchRef} className="relative flex-1 max-w-md">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-dim)] pointer-events-none"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search leads, notes, projects, tasks…"
          className="input"
          style={{ paddingLeft: "2.1rem", height: 38 }}
        />
        {searchOpen && q.trim().length >= 2 && (
          <div className="absolute left-0 right-0 mt-2 panel overflow-hidden animate-fade z-40" style={{ background: "var(--color-surface-2)" }}>
            {results.length === 0 ? (
              <div className="px-4 py-5 text-[0.82rem] text-[var(--color-muted)] text-center">
                No matches for “{q}”
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto py-1.5">
                {results.map((hit) => (
                  <button
                    key={`${hit.kind}-${hit.id}`}
                    onClick={() => go(hit)}
                    className="w-full text-left px-3.5 py-2 hover:bg-[var(--color-surface-3)] transition-colors flex items-start gap-3"
                  >
                    <span className="chip shrink-0 mt-0.5" style={{ fontSize: "0.62rem" }}>
                      {HIT_LABEL[hit.kind]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.84rem] text-[var(--color-ink)] truncate">{hit.title}</span>
                      <span className="block text-[0.74rem] text-[var(--color-muted)] truncate">
                        {hit.subtitle}
                        {hit.context ? ` — ${hit.context}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Quick add */}
      <div ref={addRef} className="relative">
        <button className="btn btn-accent" onClick={() => setAddOpen((v) => !v)}>
          <Plus size={16} />
          <span className="hidden sm:inline">Quick add</span>
        </button>
        {addOpen && (
          <div className="absolute right-0 mt-2 w-56 panel overflow-hidden animate-fade z-40" style={{ background: "var(--color-surface-2)" }}>
            <div className="py-1.5">
              {QUICK_ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.kind}
                    onClick={() => {
                      setAddOpen(false);
                      quickAdd.open(a.kind);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[var(--color-surface-3)] transition-colors flex items-center gap-3 text-[0.84rem] text-[var(--color-ink-soft)]"
                  >
                    <Icon size={15} className="text-[var(--color-muted)]" />
                    {a.label}
                  </button>
                );
              })}
            </div>
            <div className="px-3.5 py-2 border-t border-[var(--color-line)] flex items-center gap-1.5 text-[0.68rem] text-[var(--color-dim)]">
              <CornerDownLeft size={12} /> Quickly capture without leaving the page
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
