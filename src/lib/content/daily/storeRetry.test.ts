/* ============================================================
   ensureContentSchema's memoised promise must not be poisoned by one failure.

   Separate from store.test.ts on purpose: that file drives a real temp file DB
   and its beforeAll already performs the module's first bootstrap, so a
   rejection test has to own that first call. Each test here reloads the module
   (vi.resetModules) so it starts from schemaReady === null.

   getClient is stubbed, so nothing here touches any database at all.

   This is the module the identity-checked-clear pattern was originally copied
   FROM — registry.ts noted the bug in a comment and worked around it locally
   rather than fixing it at source. Here it is fixed at source: the daily cron
   and a browser saveAll() contend for the same local write lock, and one
   SQLITE_BUSY used to disable every content read and write for the life of
   the process.
   ============================================================ */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBatch, mockExecute } = vi.hoisted(() => ({
  mockBatch: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getClient: () => ({ batch: mockBatch, execute: mockExecute }),
}));

async function freshStore() {
  vi.resetModules();
  return import("./store");
}

beforeEach(() => {
  mockBatch.mockReset();
  mockExecute.mockReset().mockResolvedValue({ rows: [] });
});

describe("ensureContentSchema — a rejected bootstrap self-heals", () => {
  it("does not poison the second call when the first rejects", async () => {
    const { ensureContentSchema } = await freshStore();
    mockBatch.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    mockBatch.mockResolvedValue(undefined);

    await expect(ensureContentSchema()).rejects.toThrow(/SQLITE_BUSY/);
    await expect(ensureContentSchema()).resolves.toBeUndefined();
    expect(mockBatch).toHaveBeenCalledTimes(2);
  });

  it("lets a read retry after the failed bootstrap instead of failing forever", async () => {
    const { ensureContentSchema, listPosts } = await freshStore();
    mockBatch.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    mockBatch.mockResolvedValue(undefined);

    await expect(ensureContentSchema()).rejects.toThrow(/SQLITE_BUSY/);
    await expect(listPosts("2026-08-14")).resolves.toEqual([]);
  });

  it("still memoises a successful bootstrap — one batch for many callers", async () => {
    const { ensureContentSchema } = await freshStore();
    mockBatch.mockResolvedValue(undefined);

    await Promise.all([ensureContentSchema(), ensureContentSchema(), ensureContentSchema()]);
    await ensureContentSchema();

    expect(mockBatch).toHaveBeenCalledTimes(1);
  });
});
