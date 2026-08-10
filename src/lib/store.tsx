"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Comparable,
  CollectionKey,
  DataShape,
  DialList,
  Interaction,
  Lead,
  Milestone,
  NewsFeed,
  NewsInterests,
  NewsBookmark,
  Note,
  PainPoint,
  Playbook,
  Project,
  ProjectThread,
  Quote,
  Scorecard,
  Settings,
  Target,
  Task,
  VoiceProfile,
  VoiceSample,
} from "./types";
import { ApiAdapter } from "./db/apiAdapter";
import type { StorageAdapter } from "./db/adapter";
import { DEFAULT_SETTINGS, seedData } from "./seed";
import { reconcileFollowUps, reconcileProjects, reconcileSettings } from "./reconcile";
import { nowISO, uid } from "./utils";

/* The single persistence seam. Today: SQLite via the /api/data route
   (ApiAdapter). Swap this one line for another backend later, e.g.
   `new LocalStorageAdapter()` or `new SupabaseAdapter(client)` —
   nothing else in the app changes. */
function getAdapter(): StorageAdapter {
  return new ApiAdapter();
}

type ElementOf<K extends CollectionKey> = DataShape[K][number];
type NewRecord<K extends CollectionKey> = Omit<
  ElementOf<K>,
  "id" | "createdAt" | "updatedAt"
>;

export interface SearchHit {
  kind: Exclude<CollectionKey, "metricEntries"> | "painPoints";
  id: string;
  title: string;
  subtitle: string;
  context: string;
}

interface StoreValue extends DataShape {
  ready: boolean;
  create: <K extends CollectionKey>(key: K, value: NewRecord<K>) => ElementOf<K>;
  update: <K extends CollectionKey>(
    key: K,
    id: string,
    patch: Partial<ElementOf<K>>,
  ) => void;
  remove: <K extends CollectionKey>(key: K, id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetDemo: () => void;
  clearAll: () => void;
  search: (query: string) => SearchHit[];
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY: DataShape = {
  leads: [],
  interactions: [],
  projects: [],
  tasks: [],
  scorecards: [],
  painPoints: [],
  conversations: [],
  playbooks: [],
  targets: [],
  dialLists: [],
  positioningProfiles: [],
  voiceSamples: [],
  voiceProfile: [],
  contentThreads: [],
  brainThreads: [],
  newsFeed: [],
  newsInterests: [],
  newsBookmarks: [],
  notes: [],
  metricEntries: [],
  milestones: [],
  projectThreads: [],
  quotes: [],
  comparables: [],
  settings: DEFAULT_SETTINGS,
};

export function DataProvider({ children }: { children: React.ReactNode }) {
  const adapterRef = useRef<StorageAdapter | null>(null);
  const [data, setData] = useState<DataShape>(EMPTY);
  const [ready, setReady] = useState(false);
  // True only after a SUCCESSFUL load. Persistence is gated on this so a
  // failed/redirected hydrate (cold start, auth timing) can never save the
  // empty in-memory state back over a populated remote database.
  const hydratedOk = useRef(false);

  // hydrate once
  useEffect(() => {
    adapterRef.current = getAdapter();
    let cancelled = false;
    (async () => {
      const loaded = await adapterRef.current!.load();
      if (cancelled) return;
      if (loaded && Array.isArray(loaded.leads)) {
        // A valid payload (even all-empty arrays for a brand-new DB) — safe to
        // use and to persist from here on. Reconcile brings existing records up
        // to date with newer behaviours (e.g. backfilling lead follow-up dates,
        // and settings keys added after this row was first written).
        setData(reconcileSettings(reconcileProjects(reconcileFollowUps({ ...EMPTY, ...loaded }))));
        hydratedOk.current = true;
      } else {
        // Load FAILED (null/malformed). Start empty in memory for the UI, but
        // do NOT persist — saving empty here would wipe a populated remote DB.
        // Saves stay disabled until a reload produces a successful load.
        setData(EMPTY);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // persist on change (after a SUCCESSFUL hydration), debounced to avoid
  // hammering the API on rapid edits.
  useEffect(() => {
    if (!ready || !hydratedOk.current || !adapterRef.current) return;
    const t = setTimeout(() => {
      adapterRef.current!.save(data);
    }, 450);
    return () => clearTimeout(t);
  }, [data, ready]);

  // Flush the latest state on tab close so a change made within the
  // debounce window isn't lost (sendBeacon → POST /api/data).
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      // Never flush an unhydrated (empty) state — would wipe the remote DB.
      if (!hydratedOk.current) return;
      try {
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        navigator.sendBeacon?.("/api/data", blob);
      } catch {
        /* best effort */
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [data, ready]);

  const create = useCallback(
    <K extends CollectionKey>(key: K, value: NewRecord<K>): ElementOf<K> => {
      const record = {
        ...(value as object),
        id: uid(),
        createdAt: nowISO(),
        updatedAt: nowISO(),
      } as ElementOf<K>;
      setData((prev) => ({
        ...prev,
        [key]: [record, ...(prev[key] as ElementOf<K>[])],
      }));
      return record;
    },
    [],
  );

  const update = useCallback(
    <K extends CollectionKey>(
      key: K,
      id: string,
      patch: Partial<ElementOf<K>>,
    ) => {
      setData((prev) => ({
        ...prev,
        [key]: (prev[key] as ElementOf<K>[]).map((r) =>
          (r as { id: string }).id === id
            ? { ...r, ...patch, updatedAt: nowISO() }
            : r,
        ),
      }));
    },
    [],
  );

  const remove = useCallback(<K extends CollectionKey>(key: K, id: string) => {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] as ElementOf<K>[]).filter(
        (r) => (r as { id: string }).id !== id,
      ),
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const resetDemo = useCallback(() => {
    const seeded = seedData();
    setData(seeded);
  }, []);

  const clearAll = useCallback(() => {
    setData((prev) => ({
      ...EMPTY,
      settings: prev.settings,
    }));
  }, []);

  const search = useCallback(
    (query: string): SearchHit[] => {
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      const hits: SearchHit[] = [];
      const match = (...parts: Array<string | number | null | undefined>) =>
        parts.filter(Boolean).join(" ").toLowerCase().includes(q);

      for (const l of data.leads) {
        if (
          match(l.company, l.contactName, l.contactRole, l.email, l.industry, l.painPoint, l.notes, l.solutionIdea, l.status)
        )
          hits.push({
            kind: "leads",
            id: l.id,
            title: l.company,
            subtitle: `${l.contactName} · ${l.status}`,
            context: l.painPoint || l.notes || l.industry,
          });
      }
      for (const it of data.interactions) {
        if (match(it.company, it.contact, it.rawNotes, it.whatTheySaid, it.painPoints, it.type))
          hits.push({
            kind: "interactions",
            id: it.id,
            title: `${it.type} · ${it.company}`,
            subtitle: it.contact,
            context: it.rawNotes,
          });
      }
      for (const p of data.projects) {
        if (match(p.name, p.company, p.notes, p.nextAction, p.currentMilestone, p.stage))
          hits.push({
            kind: "projects",
            id: p.id,
            title: p.name,
            subtitle: `${p.company} · ${p.stage}`,
            context: p.nextAction || p.notes,
          });
      }
      for (const t of data.tasks) {
        if (match(t.title, t.notes, t.category, t.status))
          hits.push({
            kind: "tasks",
            id: t.id,
            title: t.title,
            subtitle: `${t.category} · ${t.status}`,
            context: t.notes,
          });
      }
      for (const pp of data.painPoints) {
        if (match(pp.painPoint, pp.industry, pp.possibleSolution, pp.notes, pp.whoMentioned))
          hits.push({
            kind: "painPoints",
            id: pp.id,
            title: pp.painPoint,
            subtitle: `${pp.industry} · freq ${pp.frequency}`,
            context: pp.possibleSolution,
          });
      }
      for (const n of data.notes) {
        if (match(n.title, n.body))
          hits.push({
            kind: "notes",
            id: n.id,
            title: n.title || "Untitled",
            subtitle: "Note",
            context: n.body.split("\n").find((l) => l.trim()) ?? "",
          });
      }
      return hits.slice(0, 30);
    },
    [data],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ...data,
      ready,
      create,
      update,
      remove,
      updateSettings,
      resetDemo,
      clearAll,
      search,
    }),
    [data, ready, create, update, remove, updateSettings, resetDemo, clearAll, search],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within DataProvider");
  return ctx;
}

/* Convenience typed selectors */
export const useLeads = () => useStore().leads as Lead[];
export const useInteractions = () => useStore().interactions as Interaction[];
export const useProjects = () => useStore().projects as Project[];
export const useTasks = () => useStore().tasks as Task[];
export const useScorecards = () => useStore().scorecards as Scorecard[];
export const usePainPoints = () => useStore().painPoints as PainPoint[];
export const useSettings = () => useStore().settings as Settings;

/** The single Playbook record, or null before it has been created. */
export const usePlaybook = () => (useStore().playbooks as Playbook[])[0] ?? null;

export const useTargets = () => useStore().targets as Target[];

export const useDialLists = () => useStore().dialLists as DialList[];

export const useNewsFeed = () => (useStore().newsFeed as NewsFeed[])[0] ?? null;
export const useNewsInterests = () =>
  (useStore().newsInterests as NewsInterests[])[0] ?? null;
export const useNewsBookmarks = () => useStore().newsBookmarks as NewsBookmark[];

export const useVoiceSamples = () => useStore().voiceSamples as VoiceSample[];
/** Singleton, following the useNewsFeed pattern above. */
export const useVoiceProfile = () =>
  (useStore().voiceProfile as VoiceProfile[])[0] ?? null;

export const useNotes = () => useStore().notes as Note[];

export const useQuotes = () => useStore().quotes as Quote[];
export const useComparables = () => useStore().comparables as Comparable[];
