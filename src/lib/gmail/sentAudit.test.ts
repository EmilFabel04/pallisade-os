import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JudgeRun } from "@/lib/gmail/sentJudge";
import { gmailGet } from "@/lib/gmail/client";
import { WARMING_LABEL } from "@/lib/gmail/sentScan";

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

const defaultThreadRaw = {
  id: "t1",
  messages: [message("emil@pallisade.io", "Worth a chat?\n\nEmil", "Wed, 10 Sep 2026 09:00:00 +0000")],
};

/** Point the shared gmailGet mock at a specific label set + thread. Used by
 *  describe blocks below that need a fixture other than the module-level
 *  default, scoped with their own beforeEach/afterEach so it can't leak. */
function mockGmailThread(labels: { id: string; name: string }[], thread: unknown) {
  vi.mocked(gmailGet).mockImplementation(async (_id: string, path: string) => {
    if (path === "labels") return { labels };
    return thread;
  });
}

function restoreDefaultGmailMock() {
  mockGmailThread([{ id: "INBOX", name: "INBOX" }], defaultThreadRaw);
}

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
    expect(res.notNudgeworthy).toBe(1);
    expect(res.stalledNotShown).toBe(0);
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
    expect(res.excludedByJudge).toBe(1);
    expect(res.excludedSignoffOnly).toBe(0);
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

// A thread where the founder wrote first, they replied, and the founder answered
// last — classifyThread's "stalled" bucket. Before this task every such thread
// was discarded unconditionally; this pins the behaviour change that makes
// Jev's needs_nudge the one that decides instead, while the heuristic (having
// no opinion on stalled threads) keeps dropping them exactly as before.
describe("auditSentFollowUps with a stalled thread", () => {
  const stalledThreadRaw = {
    id: "t-stalled",
    messages: [
      message("jane@acme.co", "Sounds good, let's talk.", "Mon, 08 Sep 2026 09:00:00 +0000"),
      message("emil@pallisade.io", "Great, following up.\n\nEmil", "Wed, 10 Sep 2026 09:00:00 +0000"),
    ],
  };

  beforeEach(() => {
    mockGmailThread([{ id: "INBOX", name: "INBOX" }], stalledThreadRaw);
  });

  afterEach(() => {
    // Restore the single-message default so this fixture never leaks into a
    // test defined elsewhere in the file.
    restoreDefaultGmailMock();
  });

  it("keeps a stalled thread when Jev says it needs a nudge", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: {
        runJudge: vi.fn().mockResolvedValue(
          jevRun({
            judgements: [{
              source: "jev", included: true, needsNudge: true,
              urgency: "warm", outreachProb: 0.9, nudgeProb: 0.7,
            }],
          }),
        ),
      },
    });

    expect(res.followUps).toHaveLength(1);
    expect(res.followUps[0].bucket).toBe("stalled");
  });

  it("still drops the same stalled thread in heuristic mode", async () => {
    const res = await auditSentFollowUps({ judge: "heuristic" });

    expect(res.followUps).toHaveLength(0);
    expect(res.stalledNotShown).toBe(1);
  });
});

// A label is a fact, not a judgement: the Apollo mailwarming safety net must
// hold even when is_my_outreach would have included the thread on its content
// alone — the model has no notion of Apollo mailwarming. This is the test
// that fails if that net is ever removed again.
describe("auditSentFollowUps with a warming-labelled thread", () => {
  const warmingThreadRaw = {
    id: "t-warming",
    messages: [
      {
        ...message("emil@pallisade.io", "Hi there,\n\nEmil", "Wed, 10 Sep 2026 09:00:00 +0000"),
        labelIds: ["SENT", "WARM_ID"],
      },
    ],
  };

  beforeEach(() => {
    mockGmailThread(
      [{ id: "INBOX", name: "INBOX" }, { id: "WARM_ID", name: WARMING_LABEL }],
      warmingThreadRaw,
    );
  });

  afterEach(() => {
    restoreDefaultGmailMock();
  });

  it("excludes a warming-labelled thread even when Jev would include it", async () => {
    const res = await auditSentFollowUps({
      judge: "jev",
      deps: {
        runJudge: vi.fn().mockResolvedValue(
          jevRun({
            judgements: [{
              source: "jev", included: true, needsNudge: true,
              urgency: "hot", outreachProb: 0.95, nudgeProb: 0.9,
            }],
          }),
        ),
      },
    });

    expect(res.followUps).toHaveLength(0);
    expect(res.excludedWarming).toBe(1);
  });
});
