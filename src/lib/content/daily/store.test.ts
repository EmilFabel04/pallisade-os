import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentPost, ContentRun } from "./types";

let store: typeof import("./store");

function post(over: Partial<ContentPost> = {}): ContentPost {
  return {
    id: "p1", date: "2026-08-04", slot: 1, pillar: "client-pain", format: "scene",
    sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
    claim: "c", body: "body", openingLine: "Opening.", checks: [], revisions: 0,
    status: "draft", killReason: null, editedBody: null,
    createdAt: "2026-08-04T04:00:00Z", updatedAt: "2026-08-04T04:00:00Z", ...over,
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pallisade-content-"));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  store = await import("./store");
  await store.ensureContentSchema();
});

describe("posts", () => {
  it("round-trips a post through save and list", async () => {
    await store.savePosts([post()]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRefs[0].anchor).toBe("14 hours");
  });

  it("returns posts for the requested date only, ordered by slot", async () => {
    await store.savePosts([post({ id: "p3", slot: 2 }), post({ id: "p2", date: "2026-08-03" })]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows.map((r) => r.slot)).toEqual([1, 2]);
  });

  it("patches only the given fields and bumps updatedAt", async () => {
    const before = (await store.listPosts("2026-08-04"))[0];
    const patched = await store.patchPost(before.id, { status: "kept" });
    expect(patched?.status).toBe("kept");
    expect(patched?.body).toBe(before.body);
    expect(patched?.updatedAt).not.toBe(before.updatedAt);
  });

  it("returns null when patching an unknown id", async () => {
    expect(await store.patchPost("nope", { status: "kept" })).toBeNull();
  });

  it("upserts rather than duplicating on repeated save", async () => {
    await store.savePosts([post({ body: "rewritten" })]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows.filter((r) => r.id === "p1")).toHaveLength(1);
    expect(rows.find((r) => r.id === "p1")?.body).toBe("rewritten");
  });

  it("returns posts inside the recency window", async () => {
    const recent = await store.recentPosts(21, "2026-08-04");
    expect(recent.some((r) => r.date === "2026-08-03")).toBe(true);
    const narrow = await store.recentPosts(1, "2026-08-04");
    expect(narrow.every((r) => r.date === "2026-08-04")).toBe(true);
  });

  it("computes the window boundary in local time, not UTC", async () => {
    // Deriving the lower bound via `new Date(today + "T00:00:00").toISOString()`
    // is off by one day at any positive UTC offset (this machine runs SAST,
    // +02:00): local midnight is 22:00 UTC the PREVIOUS day, so the window
    // silently reaches one day further back than asked. A 2-day window from
    // 2026-08-04 must start at 2026-08-03 and must not include 2026-08-02.
    await store.savePosts([post({ id: "p-edge", date: "2026-08-02" })]);
    const twoDays = await store.recentPosts(2, "2026-08-04");
    expect(twoDays.some((r) => r.date === "2026-08-03")).toBe(true);
    expect(twoDays.some((r) => r.date === "2026-08-02")).toBe(false);
  });

  it("excludes future-dated posts rather than counting them as history", async () => {
    // recentPosts feeds rotation.buildMemory, which treats everything it
    // returns as already-published history. A post dated ahead of `today` —
    // from clock skew between the cron host and the record, or a hand-created
    // row — would otherwise block its own pillar, format and source before it
    // has actually gone out.
    await store.savePosts([post({ id: "p-future", date: "2026-08-09" })]);
    const recent = await store.recentPosts(21, "2026-08-04");
    expect(recent.some((r) => r.id === "p-future")).toBe(false);
  });
});

describe("runs", () => {
  it("round-trips a run and returns the latest for a date", async () => {
    const run: ContentRun = {
      id: "r1", date: "2026-08-04", status: "ok", ledgerSize: 12,
      reachback: false, usedNews: false, degraded: [], error: null,
      startedAt: "2026-08-04T04:00:00Z", finishedAt: "2026-08-04T04:00:30Z",
    };
    await store.saveRun(run);
    expect((await store.latestRun("2026-08-04"))?.ledgerSize).toBe(12);
    expect(await store.latestRun("2026-01-01")).toBeNull();
  });
});

describe("deletion", () => {
  const run = (over: Partial<ContentRun> = {}): ContentRun => ({
    id: "r-x", date: "2026-08-05", status: "ok", ledgerSize: 3,
    reachback: false, usedNews: false, degraded: [], error: null,
    startedAt: "2026-08-05T04:00:00Z", finishedAt: "2026-08-05T04:00:30Z", ...over,
  });

  it("deletes one post and leaves the rest alone", async () => {
    await store.savePosts([post({ id: "d1" }), post({ id: "d2" })]);
    expect(await store.deletePost("d1")).toBe(true);
    const left = await store.listPosts("2026-08-04");
    expect(left.some((p) => p.id === "d1")).toBe(false);
    expect(left.some((p) => p.id === "d2")).toBe(true);
  });

  it("reports false for an id that matched nothing, so the route can 404", async () => {
    expect(await store.deletePost("does-not-exist")).toBe(false);
  });

  it("frees the deleted post's source records for reuse", async () => {
    // buildLedger excludes material cited by a post inside the 21-day window.
    // Deleting the post must release that hold, or the material stays blocked
    // by a post that no longer exists.
    await store.savePosts([post({ id: "d3", date: "2026-08-04" })]);
    expect((await store.recentPosts(21, "2026-08-04")).some((p) => p.id === "d3")).toBe(true);
    await store.deletePost("d3");
    expect((await store.recentPosts(21, "2026-08-04")).some((p) => p.id === "d3")).toBe(false);
  });

  it("deletes every post on every date and reports the count", async () => {
    await store.savePosts([
      post({ id: "a1", date: "2026-08-04" }),
      post({ id: "a2", date: "2026-07-01" }),
    ]);
    const removed = await store.deleteAllPosts();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await store.listPosts("2026-08-04")).toHaveLength(0);
    expect(await store.listPosts("2026-07-01")).toHaveLength(0);
  });

  it("deletes failed runs and keeps successful ones", async () => {
    await store.saveRun(run({ id: "ok1", status: "ok" }));
    await store.saveRun(run({ id: "thin1", status: "thin", date: "2026-08-06" }));
    await store.saveRun(run({ id: "bad1", status: "failed", error: "boom", date: "2026-08-07" }));

    const removed = await store.deleteFailedRuns();
    expect(removed).toBe(1);
    expect(await store.latestRun("2026-08-07")).toBeNull();
    expect((await store.latestRun("2026-08-05"))?.id).toBe("ok1");
    expect((await store.latestRun("2026-08-06"))?.id).toBe("thin1");
  });
});
