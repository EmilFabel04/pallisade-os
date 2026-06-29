import type { DataShape } from "../types";
import type { StorageAdapter } from "./adapter";
import { DEFAULT_SETTINGS } from "../seed";

/**
 * Client adapter that talks to the SQLite-backed /api/data route.
 * Implements the same StorageAdapter interface as LocalStorageAdapter,
 * so swapping persistence is a one-line change in store.tsx.
 *
 * All methods fail soft: if the API is unreachable the app keeps
 * working in-memory rather than crashing.
 */
export class ApiAdapter implements StorageAdapter {
  async load(): Promise<DataShape | null> {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as DataShape;
    } catch {
      return null;
    }
  }

  async save(data: DataShape): Promise<void> {
    try {
      await fetch("/api/data", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {
      /* offline / server down — non-fatal */
    }
  }

  async clear(): Promise<void> {
    const empty: DataShape = {
      leads: [],
      interactions: [],
      projects: [],
      tasks: [],
      scorecards: [],
      painPoints: [],
      conversations: [],
      playbooks: [],
      targets: [],
      positioningProfiles: [],
      contentThreads: [],
      brainThreads: [],
      newsFeed: [],
      newsInterests: [],
      newsBookmarks: [],
      settings: DEFAULT_SETTINGS,
    };
    await this.save(empty);
  }
}
