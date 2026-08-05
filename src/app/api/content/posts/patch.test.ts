import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentPost } from "@/lib/content/daily/types";

// The store is the only dependency; stub it so the route's own validation is
// what gets exercised rather than a database.
const patchPostMock = vi.fn();
vi.mock("@/lib/content/daily/store", () => ({
  patchPost: (...args: unknown[]) => patchPostMock(...args),
}));

const { PATCH } = await import("./[id]/route");

const params = Promise.resolve({ id: "p1" });
const req = (body: unknown) =>
  new Request("http://localhost/api/content/posts/p1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  patchPostMock.mockReset();
  patchPostMock.mockImplementation(async (_id: string, changes: Partial<ContentPost>) => ({
    id: "p1", ...changes,
  }));
});

describe("PATCH /api/content/posts/:id — client-writable surface", () => {
  it("accepts status, killReason and editedBody", async () => {
    const res = await PATCH(
      req({ status: "killed", killReason: "boring", editedBody: "rewritten" }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(patchPostMock).toHaveBeenCalledWith("p1", {
      status: "killed", killReason: "boring", editedBody: "rewritten",
    });
  });

  it("silently drops every field outside the allowlist", async () => {
    // Provenance is server-owned: body, claim, sourceRefs, checks, revisions
    // and the dates are the record of what the engine produced and why. A
    // client that could rewrite them could launder a fabricated post into
    // looking gate-approved.
    await PATCH(
      req({
        status: "kept",
        body: "attacker-supplied body",
        claim: "different claim",
        sourceRefs: [{ collection: "x", id: "y", anchor: "z" }],
        checks: [{ rule: "specificity", passed: true, detail: "faked" }],
        revisions: 0,
        pillar: "proof",
        date: "1999-01-01",
        id: "someone-elses-post",
      }),
      { params },
    );
    expect(patchPostMock).toHaveBeenCalledWith("p1", { status: "kept" });
  });

  it("rejects an unknown status", async () => {
    const res = await PATCH(req({ status: "published" }), { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "bad_status" });
    expect(patchPostMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown kill reason", async () => {
    const res = await PATCH(req({ killReason: "meh" }), { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "bad_kill_reason" });
    expect(patchPostMock).not.toHaveBeenCalled();
  });

  it("allows clearing the kill reason with null", async () => {
    const res = await PATCH(req({ killReason: null }), { params });
    expect(res.status).toBe(200);
    expect(patchPostMock).toHaveBeenCalledWith("p1", { killReason: null });
  });

  it("rejects a request that changes nothing", async () => {
    const res = await PATCH(req({ pillar: "proof" }), { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "no_changes" });
    expect(patchPostMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("http://localhost/api/content/posts/p1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PATCH(bad, { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "bad_request" });
  });

  it("returns 404 when the post does not exist", async () => {
    patchPostMock.mockResolvedValueOnce(null);
    const res = await PATCH(req({ status: "kept" }), { params });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns a db_failed error rather than the raw exception", async () => {
    patchPostMock.mockRejectedValueOnce(new Error("connection string leaked here"));
    const res = await PATCH(req({ status: "kept" }), { params });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("db_failed");
    expect(JSON.stringify(body)).not.toContain("connection string");
  });
});
