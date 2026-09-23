import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: { id: string; at: string; json: string }[] = [];

vi.mock("@/lib/db/client", () => ({
  getClient: () => ({
    batch: vi.fn(async () => {}),
    execute: vi.fn(async (stmt: { sql: string; args: unknown[] }) => {
      if (stmt.sql.startsWith("INSERT")) {
        rows.unshift({ id: stmt.args[0] as string, at: stmt.args[1] as string, json: stmt.args[2] as string });
        return { rows: [] };
      }
      if (stmt.sql.startsWith("DELETE")) {
        const keep = rows.slice(0, stmt.args[0] as number);
        rows.length = 0;
        rows.push(...keep);
        return { rows: [] };
      }
      const limit = (stmt.args[0] as number) ?? rows.length;
      return { rows: rows.slice(0, limit).map((r) => ({ json: r.json })) };
    }),
  }),
}));

import { saveRun, latestRun, listRuns, RUN_HISTORY } from "@/lib/gmail/followUpRuns";
import type { FollowUpRun } from "@/lib/types";

const run = (id: string, at: string): FollowUpRun => ({
  id,
  at,
  result: { scanned: 1, matched: 1, followUps: [] } as unknown as FollowUpRun["result"],
});

beforeEach(() => { rows.length = 0; });

describe("followUpRuns", () => {
  it("returns the run it just stored", async () => {
    await saveRun(run("r1", "2026-09-20T09:00:00.000Z"));
    const latest = await latestRun();
    expect(latest?.id).toBe("r1");
  });

  it("returns null when nothing has been stored", async () => {
    expect(await latestRun()).toBeNull();
  });

  it("hands back the newest run first", async () => {
    await saveRun(run("r1", "2026-09-19T09:00:00.000Z"));
    await saveRun(run("r2", "2026-09-20T09:00:00.000Z"));
    const all = await listRuns();
    expect(all.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("prunes to the newest RUN_HISTORY runs when the cap is exceeded", async () => {
    expect(RUN_HISTORY).toBe(10);

    // Saved in ascending `at` order, r1 oldest .. r12 newest — this insertion
    // order is why the mock's DELETE arm (keep the first N of an array built
    // by unshift) agrees with the real SQL (keep the newest N by `at DESC`).
    // They agree here only because insertion order matches temporal order;
    // the mock does not independently sort by `at`.
    for (let i = 1; i <= 12; i++) {
      await saveRun(run(`r${i}`, `2026-09-${String(i).padStart(2, "0")}T09:00:00.000Z`));
    }

    // Ask for more than RUN_HISTORY back. listRuns's own default LIMIT would
    // mask a broken prune (it caps reads at RUN_HISTORY regardless of what
    // saveRun did), so this must request a larger limit to prove the DELETE
    // in saveRun actually removed rows from the table rather than merely
    // relying on the read side to truncate the response.
    const all = await listRuns(20);
    const ids = all.map((r) => r.id);

    expect(all).toHaveLength(10);
    expect(ids[0]).toBe("r12"); // newest first
    expect(ids).not.toContain("r1"); // oldest, pruned
    expect(ids).not.toContain("r2"); // second-oldest, pruned
  });
});
