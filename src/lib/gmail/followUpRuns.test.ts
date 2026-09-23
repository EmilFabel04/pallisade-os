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

  it("keeps ten runs of history", () => {
    expect(RUN_HISTORY).toBe(10);
  });
});
