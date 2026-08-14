/* ============================================================
   The truncation notice both chat surfaces render.

   These tests are the closest a node-environment suite can get to pinning the
   rendered notice — the pages are .tsx client components, vitest here runs
   `environment: "node"`, and its include glob only picks up .test.ts, so there
   is no component render available. The copy and the branch logic live in this pure
   module for exactly that reason; the source guards in brainClient.test.ts and
   advisorClient.test.ts pin that each page actually calls it.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stopNotice } from "@/lib/agents/stopNotice";

describe("stopNotice", () => {
  it("says nothing when the agent finished on its own", () => {
    expect(stopNotice("end")).toBeNull();
  });

  it("says nothing when the server sent no stop reason at all", () => {
    expect(stopNotice(undefined)).toBeNull();
    expect(stopNotice(null)).toBeNull();
  });

  it("names the tool-call limit, and what to do about it, on max_iterations", () => {
    const n = stopNotice("max_iterations")!;
    expect(n).toContain("cut short");
    expect(n).toContain("tool-call limit");
    // Actionable, not just informative — the founder needs a next move.
    expect(n).toMatch(/narrower|continue/);
  });

  it("names the length limit on max_tokens, and does not blame the tool cap", () => {
    const n = stopNotice("max_tokens")!;
    expect(n).toContain("cut short");
    expect(n).toContain("length limit");
    expect(n).not.toContain("tool-call limit");
  });

  it("gives the two truncation reasons different copy", () => {
    expect(stopNotice("max_iterations")).not.toBe(stopNotice("max_tokens"));
  });
});

/* Both pages must actually consult it. A pure helper nothing renders is the
   same silent truncation with an extra file. */
describe("both chat surfaces render the notice", () => {
  const page = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  for (const p of ["src/app/brain/page.tsx", "src/app/advisor/page.tsx"]) {
    it(`${p} imports stopNotice, feeds it reply.stoppedBy, and renders the result`, () => {
      const src = page(p);
      expect(src).toMatch(/from "@\/lib\/agents\/stopNotice"/);
      expect(src).toMatch(/setNotice\(stopNotice\(reply\.stoppedBy\)\)/);
      expect(src).toMatch(/\{notice && </);
    });
  }
});
