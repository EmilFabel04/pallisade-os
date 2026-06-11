import type { DataShape } from "../types";
import type { StorageAdapter } from "./adapter";

const STORAGE_KEY = "pallisade-os:v1";

/**
 * localStorage-backed adapter. Synchronous under the hood but wrapped
 * in Promises so the interface matches a future async remote adapter
 * (Supabase/Firebase) with zero call-site changes.
 */
export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<DataShape | null> {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as DataShape;
    } catch {
      return null;
    }
  }

  async save(data: DataShape): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota / serialization — non-fatal for a local app */
    }
  }

  async clear(): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
