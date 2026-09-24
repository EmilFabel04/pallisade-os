import { describe, it, expect, vi, beforeEach } from "vitest";

let gmailConfiguredValue = true;
let jevConfiguredValue = true;

const listAccountInfo = vi.fn();
const latestRun = vi.fn();

vi.mock("@/lib/gmail/config", () => ({ isConfigured: () => gmailConfiguredValue }));
vi.mock("@/lib/jev/client", () => ({ isConfigured: () => jevConfiguredValue }));
vi.mock("@/lib/gmail/accounts", () => ({
  listAccountInfo: (...args: unknown[]) => listAccountInfo(...args),
}));
vi.mock("@/lib/gmail/followUpRuns", () => ({
  latestRun: (...args: unknown[]) => latestRun(...args),
}));

import { GET } from "@/app/api/followups/route";

beforeEach(() => {
  vi.clearAllMocks();
  gmailConfiguredValue = true;
  jevConfiguredValue = true;
  listAccountInfo.mockResolvedValue([{ id: "a1", email: "emil@pallisade.io", createdAt: "2026-01-01" }]);
  latestRun.mockResolvedValue(null);
});

// `configured.gmail` is only an env check — it says nothing about whether an
// inbox is actually linked. accountCount is what the page uses to tell "no
// inbox connected" apart from "linked, nothing owed" — see follow-ups/page.tsx.
describe("GET /api/followups", () => {
  it("reports the connected-account count alongside configuration", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.configured).toEqual({ gmail: true, jev: true });
    expect(body.accountCount).toBe(1);
  });

  it("reports zero accounts when none are linked, even though gmail credentials are configured", async () => {
    listAccountInfo.mockResolvedValue([]);
    const res = await GET();
    const body = await res.json();

    expect(body.configured.gmail).toBe(true);
    expect(body.accountCount).toBe(0);
  });

  it("never queries accounts when gmail credentials aren't configured", async () => {
    gmailConfiguredValue = false;
    const res = await GET();
    const body = await res.json();

    expect(body.configured.gmail).toBe(false);
    expect(body.accountCount).toBe(0);
    expect(listAccountInfo).not.toHaveBeenCalled();
  });

  it("surfaces a storage failure as a 502", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    latestRun.mockRejectedValue(new Error("db down"));

    const res = await GET();

    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});
