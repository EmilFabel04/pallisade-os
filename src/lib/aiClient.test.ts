/* ============================================================
   aiClient has no local fallback: every failure mode must reject
   with AIUnavailable, never resolve with something the UI would
   render as a successful answer.

   The critical regression case: api/ai/route.ts always spreads
   `{ ...result, generatedAt }` onto whatever it parsed, so an empty
   model response (no text block) can arrive at the client as a
   *truthy* `{ result: { generatedAt: "..." } }` — a 200 that
   `!data?.result` alone would wave through. That object would then
   get written into the store and rendered "✓ Generated", crashing
   on reopen because none of the real fields (keyPainPoints, etc.)
   exist. The client must catch this shape even if a future route
   regression reintroduces it — defence in depth alongside the
   route-side fix.
   ============================================================ */

import { describe, it, expect, vi, afterEach } from "vitest";
import { requestCallSummary, requestBusinessReview, AIUnavailable } from "./aiClient";

afterEach(() => vi.unstubAllGlobals());

const callInput = { rawNotes: "we spoke about pricing" };

const fullCallSummary = {
  cleanSummary: "x",
  keyPainPoints: ["a"],
  objections: [],
  buyingSignals: [],
  suggestedFollowUpMessage: "hi",
  suggestedNextStep: "call back",
  offerAngle: "automation",
  generatedAt: "2026-08-13T00:00:00.000Z",
};

describe("aiClient — no silent fallback; every failure mode rejects", () => {
  it("503 rejects with AIUnavailable(no_key)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, ok: false })));
    await expect(requestCallSummary(callInput)).rejects.toMatchObject({ code: "no_key" });
  });

  it("a non-ok status rejects with AIUnavailable(failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, ok: false })));
    await expect(requestCallSummary(callInput)).rejects.toBeInstanceOf(AIUnavailable);
  });

  it("a network failure rejects with AIUnavailable(failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(requestBusinessReview("text")).rejects.toBeInstanceOf(AIUnavailable);
  });

  it("a 200 body with no result key rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) })));
    await expect(requestCallSummary(callInput)).rejects.toBeInstanceOf(AIUnavailable);
  });

  it("a 200 whose result is only {generatedAt} (the empty-model-output shape the route can stamp) rejects, not resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ result: { generatedAt: "2026-08-13T00:00:00.000Z" } }),
      })),
    );
    await expect(requestCallSummary(callInput)).rejects.toBeInstanceOf(AIUnavailable);
  });

  it("a full valid result still resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ result: fullCallSummary }) })),
    );
    await expect(requestCallSummary(callInput)).resolves.toEqual(fullCallSummary);
  });
});
