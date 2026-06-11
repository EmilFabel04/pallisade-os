import type { DataShape } from "../types";

/* ============================================================
   Storage seam.
   The app talks to this interface only — never to localStorage
   directly. To move to Supabase/Firebase later, implement this
   same interface against the remote client and swap it in
   `store.tsx` (see getAdapter()).
   ============================================================ */

export interface StorageAdapter {
  /** Load the entire dataset (or null if nothing persisted yet). */
  load(): Promise<DataShape | null>;
  /** Persist the entire dataset. Local impl is whole-blob; a remote
   *  impl can diff or write per-collection — the contract is "saved". */
  save(data: DataShape): Promise<void>;
  /** Wipe persisted data (used by "reset to demo data"). */
  clear(): Promise<void>;
}
