import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLLECTIONS } from "./sqlite";
import { seedData } from "@/lib/seed";
import type { DataShape } from "@/lib/types";

describe("sqlite COLLECTIONS registry", () => {
  it("includes the news collections so they persist", () => {
    expect(COLLECTIONS).toContain("newsFeed");
    expect(COLLECTIONS).toContain("newsInterests");
    expect(COLLECTIONS).toContain("newsBookmarks");
  });
});

describe("sqlite COLLECTIONS registry — project tracker", () => {
  it("includes the milestone and project-thread collections so they persist", () => {
    expect(COLLECTIONS).toContain("milestones");
    expect(COLLECTIONS).toContain("projectThreads");
  });
});

describe("sqlite COLLECTIONS registry — voice capture", () => {
  it("includes the voice collections so they persist", () => {
    expect(COLLECTIONS).toContain("voiceSamples");
    expect(COLLECTIONS).toContain("voiceProfile");
  });

  it("covers every array collection on DataShape", () => {
    // Membership of this registry is what creates the table and what
    // saveAll/loadAll iterate. A collection added to DataShape but forgotten
    // here type-checks perfectly and simply never persists — the failure is
    // silent and only shows up as data vanishing on reload. Derived from a
    // real value rather than a hand-kept list so it cannot drift.
    const expected = Object.entries(seedData())
      .filter(([, v]) => Array.isArray(v))
      .map(([k]) => k)
      .sort();
    expect([...COLLECTIONS].sort()).toEqual(expected);
  });
});

describe("sqlite round-trip", () => {
  let db: typeof import("./sqlite");

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pallisade-sqlite-"));
    process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
    delete process.env.TURSO_AUTH_TOKEN;
    db = await import("./sqlite");
  });

  it("persists and reloads the voice collections", async () => {
    const data: DataShape = {
      ...seedData(),
      voiceSamples: [{
        id: "vs1", createdAt: "2026-08-04T00:00:00Z", updatedAt: "2026-08-04T00:00:00Z",
        text: "Shipped it Tuesday. Nobody asked for a dashboard.", source: "linkedin",
      }],
      voiceProfile: [{
        id: "vp1", createdAt: "2026-08-04T00:00:00Z", updatedAt: "2026-08-04T00:00:00Z",
        stats: {
          burstiness: 0.4, avgSentenceLength: 9, shortSentenceRatio: 0.5,
          contractionRate: 2, questionRate: 0, avgParagraphSentences: 1.5,
          emojiPerPost: 0, firstPersonRate: 3,
        },
        fingerprint: "short, concrete, no wind-up",
        neverSay: ["leverage"], sampleCount: 1, computedAt: "2026-08-04T00:00:00Z",
      }],
    };

    await db.saveAll(data);
    const loaded = await db.loadAll();

    expect(loaded.voiceSamples).toHaveLength(1);
    expect(loaded.voiceSamples[0].source).toBe("linkedin");
    expect(loaded.voiceProfile).toHaveLength(1);
    expect(loaded.voiceProfile[0].neverSay).toEqual(["leverage"]);
    expect(loaded.voiceProfile[0].stats.burstiness).toBe(0.4);
  });
});
