import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAgentSchema, loadOverrides, saveOverride, clearOverride } from "@/lib/agents/overrides";
import { getClient } from "@/lib/db/client";

let dir: string;

describe("agent overrides", () => {
  beforeAll(() => {
    // MUST run before any getClient() call, or this test writes to real data.
    dir = mkdtempSync(join(tmpdir(), "agentdb-"));
    process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await ensureAgentSchema();
    await getClient().execute("DELETE FROM agentOverrides");
  });

  it("returns an empty map when nothing is overridden", async () => {
    expect((await loadOverrides()).size).toBe(0);
  });

  it("round-trips a saved body", async () => {
    await saveOverride("deal-strategist", "custom prompt");
    expect((await loadOverrides()).get("deal-strategist")).toBe("custom prompt");
  });

  it("replaces an existing override rather than duplicating it", async () => {
    await saveOverride("deal-strategist", "first");
    await saveOverride("deal-strategist", "second");
    const m = await loadOverrides();
    expect(m.size).toBe(1);
    expect(m.get("deal-strategist")).toBe("second");
  });

  it("clears an override", async () => {
    await saveOverride("deal-strategist", "custom");
    await clearOverride("deal-strategist");
    expect((await loadOverrides()).has("deal-strategist")).toBe(false);
  });

  it("clearing an absent override is a no-op", async () => {
    await expect(clearOverride("never-existed")).resolves.toBeUndefined();
  });
});
