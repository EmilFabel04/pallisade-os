/* ============================================================
   Exercises the real GET against the SHIPPED roster in src/agents —
   listAgents() -> loadRegistry() -> loadOverrides() is DB-backed
   (getClient() defaults to file:data/pallisade.db, the founder's real
   production database). Stub loadOverrides at the module boundary so
   this file never touches the DB. See the task brief's "Database
   hazard" section and the same pattern in
   src/lib/agents/registry.test.ts and src/lib/agents/roster.test.ts.
   ============================================================ */

import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/agents/route";

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));

const call = (url: string) => GET(new Request(url));

describe("GET /api/agents", () => {
  it("returns the cards for a surface", async () => {
    const res = await call("http://x/api/agents?surface=brain");
    expect(res.status).toBe(200);
    const { agents } = await res.json();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("emoji");
  });

  it("never leaks the system prompt or the tool grant", async () => {
    const { agents } = await (await call("http://x/api/agents?surface=brain")).json();
    for (const a of agents) {
      expect(Object.keys(a).sort())
        .toEqual(["color", "description", "emoji", "id", "name", "vibe"]);
    }
  });

  it("rejects an unknown surface", async () => {
    expect((await call("http://x/api/agents?surface=nope")).status).toBe(400);
  });

  it("rejects a missing surface", async () => {
    expect((await call("http://x/api/agents")).status).toBe(400);
  });
});
