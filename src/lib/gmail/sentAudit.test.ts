import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JudgeRun } from "@/lib/gmail/sentJudge";

vi.mock("@/lib/gmail/accounts", () => ({
  listAccountInfo: vi.fn().mockResolvedValue([{ id: "a1", email: "emil@pallisade.io" }]),
}));

const message = (from: string, text: string, date: string) => ({
  labelIds: from === "emil@pallisade.io" ? ["SENT"] : ["INBOX"],
  payload: {
    headers: [
      { name: "From", value: from },
      { name: "To", value: from === "emil@pallisade.io" ? "jane@acme.co" : "emil@pallisade.io" },
      { name: "Subject", value: "Quick question" },
      { name: "Date", value: date },
    ],
    body: { data: Buffer.from(text).toString("base64url") },
  },
  internalDate: String(Date.parse(date)),
});

vi.mock("@/lib/gmail/client", () => ({
  gmailGet: vi.fn(async (_id: string, path: string) => {
    if (path === "labels") return { labels: [{ id: "INBOX", name: "INBOX" }] };
    return {
      id: "t1",
      messages: [message("emil@pallisade.io", "Worth a chat?\n\nEmil", "Wed, 10 Sep 2026 09:00:00 +0000")],
    };
  }),
  GmailAuthError: class GmailAuthError extends Error {},
}));

vi.mock("@/lib/gmail/gmailApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gmail/gmailApi")>()),
  listThreadIds: vi.fn().mockResolvedValue({ ids: ["t1"], truncated: false }),
}));

vi.mock("@/lib/jev/client", () => ({
  isConfigured: () => true,
  USD_PER_INPUT_TOKEN: 0.042 / 1_000_000,
  evaluate: vi.fn().mockResolvedValue({
    model: "jev-1.13.0",
    answers: {
      is_my_outreach: { type: "noul", noul: 0.93 },
      needs_nudge: { type: "noul", noul: 0.88 },
      urgency: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 0.9 },
    },
    usage: { input_tokens: 420, output_tokens: 10 },
  }),
}));

import { auditSentFollowUps } from "@/lib/gmail/sentAudit";

const jevRun = (over: Partial<JudgeRun> = {}): JudgeRun => ({
  judgements: [{
    source: "jev", included: true, needsNudge: true,
    urgency: "hot", outreachProb: 0.93, nudgeProb: 0.88,
  }],
  inputTokens: 420,
  costUSD: 420 * (0.042 / 1_000_000),
  failures: 0,
  calls: 1,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("auditSentFollowUps in jev mode", () => {
  it("returns follow-ups carrying the Jev verdict, not merely a configured judge", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: { runJudge: vi.fn().mockResolvedValue(jevRun()) },
    });

    expect(res.followUps).toHaveLength(1);
    expect(res.followUps[0].judgement).toMatchObject({
      source: "jev", urgency: "hot", nudgeProb: 0.88,
    });
    expect(res.degraded).toBe(false);
  });

  it("reports the real token count and price", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: { runJudge: vi.fn().mockResolvedValue(jevRun()) },
    });

    expect(res.judgeStats.inputTokens).toBe(420);
    expect(res.judgeStats.costUSD).toBeCloseTo(420 * (0.042 / 1_000_000), 12);
    expect(res.judgeStats.calls).toBe(1);
  });

  it("falls back to the heuristic and flags the run when Jev yields nothing", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: { runJudge: vi.fn().mockResolvedValue(jevRun({ judgements: [null], failures: 1 })) },
    });

    expect(res.degraded).toBe(true);
    expect(res.followUps[0].judgement.source).toBe("heuristic");
    expect(res.followUps[0].judgement.urgency).toBeNull();
    expect(res.judgeStats.failures).toBe(1);
  });

  it("drops a thread Jev says needs no nudge", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: {
        runJudge: vi.fn().mockResolvedValue(
          jevRun({
            judgements: [{
              source: "jev", included: true, needsNudge: false,
              urgency: "dead", outreachProb: 0.9, nudgeProb: 0.1,
            }],
          }),
        ),
      },
    });

    expect(res.followUps).toHaveLength(0);
  });

  it("never calls Jev in heuristic mode", async () => {
    const runJudgeMock = vi.fn();
    const res = await auditSentFollowUps({ judge: "heuristic", deps: { runJudge: runJudgeMock } });

    expect(runJudgeMock).not.toHaveBeenCalled();
    expect(res.judgeStats.mode).toBe("heuristic");
    expect(res.followUps[0]?.judgement.source).toBe("heuristic");
  });

  it("counts agreement in compare mode", async () => {
    const res = await auditSentFollowUps({
      judge: "both",
      deps: { runJudge: vi.fn().mockResolvedValue(jevRun()) },
    });

    expect(res.judgeStats.agreements).toBe(1);
    expect(res.judgeStats.disagreements).toBe(0);
    expect(res.followUps[0].agrees).toBe(true);
  });

  it("marks a disagreement when Jev excludes what the heuristic included", async () => {
    const res = await auditSentFollowUps({
      judge: "both",
      deps: {
        runJudge: vi.fn().mockResolvedValue(
          jevRun({
            judgements: [{
              source: "jev", included: false, needsNudge: false,
              urgency: "dead", outreachProb: 0.1, nudgeProb: 0.1,
            }],
          }),
        ),
      },
    });

    expect(res.judgeStats.disagreements).toBe(1);
    expect(res.followUps).toHaveLength(0);
  });
});

import { resolveEmailTool } from "@/lib/gmail/advisorEmail";

describe("the advisor's audit tool", () => {
  it("returns Jev-judged follow-ups, not the bare heuristic", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const payload = JSON.parse(await resolveEmailTool("audit_sent_followups", { limit: 10 }));

    expect(payload.judgeStats.mode).toBe("jev");
    expect(payload.followUps[0]).toHaveProperty("judgement");
  });
});
