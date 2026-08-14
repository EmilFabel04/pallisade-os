/* ============================================================
   What the Brain page actually sends the route.

   Source guards, deliberately. vitest runs `environment: "node"` and its
   include glob only picks up .test.ts, so a .tsx client component cannot be
   rendered here — and the route-level tests in
   src/app/api/brain/route.test.ts can only prove the ROUTE handles a field
   correctly once it arrives. The bug in both cases below was the page not
   sending it, which no route test can see. Until this project grows a
   component-test environment, these are the assertions that fail on it.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("brain client", () => {
  it("sends an agentId to the brain route", () => {
    expect(read("src/lib/brainClient.ts")).toMatch(/agentId/);
  });

  /* Finding 1. driveAccountId used to be a client-supplied field the page
     populated only on the brainstorm branch, so the strategist's Drive tools
     answered "not connected" on every call and it relayed that to the founder.
     The route resolves it server-side now; the client must not send one, or
     the browser is naming the account an agent reads from. */
  it("does not send a driveAccountId — the route resolves Drive server-side", () => {
    expect(read("src/lib/brainClient.ts")).not.toMatch(/driveAccountId/);
    expect(read("src/app/brain/page.tsx")).not.toMatch(/driveAccountId/);
  });
});

describe("the Brain page's turn context", () => {
  const page = read("src/app/brain/page.tsx");

  /* Finding 4. deal-strategist, discovery-coach and pipeline-analyst all
     interpolate {{services}}; the page sent only businessName and founderName,
     so the route fell through to its hardcoded DEFAULT_SERVICES and the
     founder's Settings edit was honoured by the Advisor and silently ignored
     by three Brain specialists. */
  it("forwards the founder's Services setting", () => {
    expect(page).toMatch(/services:\s*settings\.services/);
  });

  it("forwards businessName and founderName from settings too", () => {
    expect(page).toMatch(/businessName:\s*settings\.businessName/);
    expect(page).toMatch(/founderName:\s*settings\.founderName/);
  });
});
