import { describe, it, expect, vi, beforeEach } from "vitest";

const audit = vi.fn();
const saveRun = vi.fn();

vi.mock("@/lib/gmail/sentAudit", () => ({
  auditSentFollowUps: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/gmail/followUpRuns", () => ({
  saveRun: (...args: unknown[]) => saveRun(...args),
}));
vi.mock("@/lib/gmail/config", () => ({ isConfigured: () => true }));

import { POST } from "@/app/api/followups/run/route";

const result = {
  scanned: 3, matched: 1, followUps: [{ email: "jane@acme.co" }],
  judgeStats: { mode: "jev", calls: 3, failures: 0, inputTokens: 900, costUSD: 0.0000378, ms: 4200, agreements: 0, disagreements: 0 },
  degraded: false,
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/followups/run", {
    method: "POST",
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  audit.mockResolvedValue(result);
});

describe("POST /api/followups/run", () => {
  it("returns the stored run, not just an ack", async () => {
    const res = await post({ limit: 150, judge: "jev" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.result.followUps).toHaveLength(1);
    expect(body.result.judgeStats.inputTokens).toBe(900);
    expect(body.at).toBeTruthy();
  });

  it("persists the run it returns", async () => {
    const res = await post({ limit: 50 });
    const body = await res.json();

    expect(saveRun).toHaveBeenCalledTimes(1);
    expect(saveRun.mock.calls[0][0].id).toBe(body.id);
  });

  it("passes the requested scan size and mode through", async () => {
    await post({ limit: 50, judge: "both" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, judge: "both" }));
  });

  it("rejects a judge mode it does not know", async () => {
    const res = await post({ judge: "vibes" });
    expect(res.status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
  });

  it("surfaces an audit failure as a 502", async () => {
    audit.mockRejectedValue(new Error("gmail exploded"));
    const res = await post({ limit: 50 });
    expect(res.status).toBe(502);
  });
});
