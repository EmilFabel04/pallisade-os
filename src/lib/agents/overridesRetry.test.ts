/* ============================================================
   ensureAgentSchema's memoised promise must not be poisoned by one failure.

   Separate from overrides.test.ts on purpose: that file drives a real temp
   file DB, and `schemaReady` is module state its first call already sets — a
   rejection test has to own the module's first call. Each test here reloads
   the module (vi.resetModules) so it starts from schemaReady === null.

   getClient is stubbed, so nothing here touches any database at all.
   ============================================================ */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBatch, mockExecute } = vi.hoisted(() => ({
  mockBatch: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getClient: () => ({ batch: mockBatch, execute: mockExecute }),
}));

/** A fresh copy of the module, with schemaReady back to null. */
async function freshOverrides() {
  vi.resetModules();
  return import("@/lib/agents/overrides");
}

beforeEach(() => {
  mockBatch.mockReset();
  mockExecute.mockReset().mockResolvedValue({ rows: [] });
});

describe("ensureAgentSchema — a rejected bootstrap self-heals", () => {
  /* The whole point. registry.ts clears its own cache on failure so a
     transient fault retries; that retry runs loadRegistry -> loadOverrides ->
     ensureAgentSchema. While this promise stayed poisoned, the retry got the
     SAME rejection back and the registry's fix could not work — one
     SQLITE_BUSY took the Brain, the Advisor, the roster and Settings down
     until the process restarted. */
  it("does not poison the second call when the first rejects", async () => {
    const { ensureAgentSchema } = await freshOverrides();
    mockBatch.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    mockBatch.mockResolvedValue(undefined);

    await expect(ensureAgentSchema()).rejects.toThrow(/SQLITE_BUSY/);
    // Pre-fix this rejects too, handed the very same cached promise.
    await expect(ensureAgentSchema()).resolves.toBeUndefined();
    expect(mockBatch).toHaveBeenCalledTimes(2);
  });

  it("retries for every consumer, not just the one that saw the failure", async () => {
    const { ensureAgentSchema, loadOverrides } = await freshOverrides();
    mockBatch.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    mockBatch.mockResolvedValue(undefined);

    await expect(ensureAgentSchema()).rejects.toThrow(/SQLITE_BUSY/);
    // loadOverrides awaits ensureAgentSchema first — the registry's path back
    // in. It must get a live bootstrap, not the poisoned one.
    await expect(loadOverrides()).resolves.toBeInstanceOf(Map);
  });

  it("still memoises a successful bootstrap — one batch for many callers", async () => {
    const { ensureAgentSchema } = await freshOverrides();
    mockBatch.mockResolvedValue(undefined);

    await Promise.all([ensureAgentSchema(), ensureAgentSchema(), ensureAgentSchema()]);
    await ensureAgentSchema();

    expect(mockBatch).toHaveBeenCalledTimes(1);
  });
});
