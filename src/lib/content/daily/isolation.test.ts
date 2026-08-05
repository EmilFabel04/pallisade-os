import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedData } from "@/lib/seed";
import type { ContentPost, ContentRun } from "./types";

/**
 * The central isolation claim of this design: contentPosts and contentRuns are
 * server-authored and deliberately absent from the COLLECTIONS array that
 * saveAll() deletes and reinserts from the client's snapshot.
 *
 * Without that, a browser tab opened before the 06:00 cron holds a snapshot
 * with no posts in it; the next time the founder edits a lead, the client PUTs
 * that stale snapshot and saveAll wipes the cron's rows. The failure is
 * invisible — the posts simply are not there — which is exactly why it is
 * pinned here rather than left to the COLLECTIONS array's comment.
 */
let store: typeof import("./store");
let db: typeof import("@/lib/db/sqlite");

const post = (over: Partial<ContentPost> = {}): ContentPost => ({
  id: "p1", date: "2026-08-04", slot: 1, pillar: "client-pain", format: "scene",
  sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
  claim: "c", body: "body", openingLine: "Opening.", checks: [], revisions: 0,
  status: "draft", killReason: null, editedBody: null,
  createdAt: "2026-08-04T04:00:00Z", updatedAt: "2026-08-04T04:00:00Z", ...over,
});

const run: ContentRun = {
  id: "r1", date: "2026-08-04", status: "ok", ledgerSize: 9,
  reachback: false, usedNews: false, degraded: [], error: null,
  startedAt: "2026-08-04T04:00:00Z", finishedAt: "2026-08-04T04:00:30Z",
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pallisade-isolation-"));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  store = await import("./store");
  db = await import("@/lib/db/sqlite");
  await store.ensureContentSchema();
});

describe("server-authored tables survive a client snapshot save", () => {
  it("keeps the cron's posts and run when a stale client PUTs its whole snapshot", async () => {
    await store.savePosts([post(), post({ id: "p2", slot: 2 })]);
    await store.saveRun(run);
    expect(await store.listPosts("2026-08-04")).toHaveLength(2);

    // Exactly what the client's PUT /api/data triggers. seedData() is a
    // populated snapshot, so this takes the normal destructive path rather
    // than tripping saveAll's empty-payload safety net.
    await db.saveAll(db.COLLECTIONS.reduce(
      (acc, c) => ({ ...acc, [c]: [] }),
      { ...seedData() },
    ));

    const survived = await store.listPosts("2026-08-04");
    expect(survived).toHaveLength(2);
    expect(survived.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect((await store.latestRun("2026-08-04"))?.ledgerSize).toBe(9);
  });

  it("does not list the content tables among the client-owned collections", () => {
    // The registry drives saveAll's DELETE loop, so membership here is the
    // hazard itself, not merely a symptom of it.
    expect(db.COLLECTIONS).not.toContain("contentPosts");
    expect(db.COLLECTIONS).not.toContain("contentRuns");
  });
});
