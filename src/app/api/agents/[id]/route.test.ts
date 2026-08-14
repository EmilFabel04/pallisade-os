/* ============================================================
   Exercises the real PUT/DELETE/GET against the SHIPPED roster in
   src/agents. getAgent -> loadRegistry -> loadOverrides is DB-backed
   (getClient() defaults to file:data/pallisade.db, the founder's real
   production database). Redirect TURSO_DATABASE_URL to a temp file in
   beforeAll, BEFORE any getClient() call — none of the imports below
   touch the DB at module-eval time, only inside the functions they
   export, so a top-level static import is safe here. Clean up written
   overrides in afterEach so the roster tests elsewhere stay
   deterministic. See the task brief's "Database hazard" section and the
   same pattern in src/lib/agents/overrides.test.ts.
   ============================================================ */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT, DELETE } from "@/app/api/agents/[id]/route";
import { clearOverride, loadOverrides } from "@/lib/agents/overrides";
import { resetRegistryCache } from "@/lib/agents/registry";

let dir: string;

beforeAll(() => {
  // MUST run before any getClient() call, or these tests write to the
  // founder's real production database.
  dir = mkdtempSync(join(tmpdir(), "agent-route-db-"));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("agent override endpoints", () => {
  afterEach(async () => {
    await clearOverride("strategist");
    resetRegistryCache();
  });

  it("saves an override for a known agent", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "custom" }) });
    expect((await PUT(req, params("strategist"))).status).toBe(200);
  });

  it("rejects an unknown agent on PUT", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "x" }) });
    expect((await PUT(req, params("nope"))).status).toBe(404);
  });

  it("rejects an unknown agent on DELETE", async () => {
    expect((await DELETE(new Request("http://x"), params("nope"))).status).toBe(404);
  });

  it("rejects an unknown agent on GET", async () => {
    expect((await GET(new Request("http://x"), params("nope"))).status).toBe(404);
  });

  it("rejects an empty body and writes nothing", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "  " }) });
    expect((await PUT(req, params("strategist"))).status).toBe(400);
    expect((await loadOverrides()).has("strategist")).toBe(false);
  });

  it("rejects a missing body field and writes nothing", async () => {
    const req = new Request("http://x", { method: "PUT", body: JSON.stringify({}) });
    expect((await PUT(req, params("strategist"))).status).toBe(400);
    expect((await loadOverrides()).has("strategist")).toBe(false);
  });

  it("clears an override", async () => {
    expect((await DELETE(new Request("http://x"), params("strategist"))).status).toBe(200);
  });

  it("GET returns the current body, and reset genuinely reverts to the file body", async () => {
    const before = await GET(new Request("http://x"), params("strategist"));
    expect(before.status).toBe(200);
    const beforeJson = await before.json();
    const original = beforeJson.body as string;
    expect(typeof original).toBe("string");
    expect(beforeJson.overridden).toBe(false);

    const putRes = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "OVERRIDDEN PERSONA" }) }),
      params("strategist"),
    );
    expect(putRes.status).toBe(200);

    const after = await GET(new Request("http://x"), params("strategist"));
    const afterJson = await after.json();
    expect(afterJson.body).toBe("OVERRIDDEN PERSONA");
    expect(afterJson.overridden).toBe(true);

    const delRes = await DELETE(new Request("http://x"), params("strategist"));
    expect(delRes.status).toBe(200);

    const reverted = await GET(new Request("http://x"), params("strategist"));
    const revertedJson = await reverted.json();
    expect(revertedJson.body).toBe(original);
    expect(revertedJson.overridden).toBe(false);
  });

  it("never leaks a widened tool grant through an override (grants stay file-owned)", async () => {
    const before = await GET(new Request("http://x"), params("strategist"));
    const beforeTools = (await before.json()).tools;

    await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify({ body: "irrelevant to tools" }) }),
      params("strategist"),
    );

    const after = await GET(new Request("http://x"), params("strategist"));
    const afterJson = await after.json();
    expect(afterJson.tools).toEqual(beforeTools);
  });
});
