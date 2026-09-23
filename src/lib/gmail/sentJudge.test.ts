import { describe, it, expect, vi } from "vitest";
import {
  buildJudgeState, interpretJudgement, heuristicJudgement, runJudge, JUDGE_CONCURRENCY,
  JUDGE_QUESTIONS, STATE_CHAR_BUDGET, URGENCY_LEVELS,
} from "@/lib/gmail/sentJudge";
import { JevError, type JevAnswer } from "@/lib/jev/types";
import type { ScanMessage } from "@/lib/gmail/sentScan";

const own = new Set(["emil@pallisade.io"]);

const msg = (over: Partial<ScanMessage> = {}): ScanMessage => ({
  from: "emil@pallisade.io",
  to: [{ name: "Jane Roe", email: "jane@acme.co" }],
  date: "2026-09-10T09:00:00.000Z",
  text: "Worth a chat?",
  ...over,
});

const answers = (over: Record<string, JevAnswer> = {}): Record<string, JevAnswer> => ({
  is_my_outreach: { type: "noul", noul: 0.9 },
  needs_nudge: { type: "noul", noul: 0.8 },
  urgency: {
    type: "score", score: 2.0, legend: {}, probabilities: {}, confidence: 0.9,
  },
  ...over,
});

describe("buildJudgeState", () => {
  it("labels the founder's messages and the counterparty's", () => {
    const state = buildJudgeState({
      subject: "Pilot scope",
      messages: [msg(), msg({ from: "jane@acme.co", text: "Let me think." })],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    expect(state.messages.map((m) => m.author)).toEqual(["founder", "them"]);
  });

  it("orders newest first so truncation drops the oldest", () => {
    const state = buildJudgeState({
      subject: "s",
      messages: [
        msg({ date: "2026-09-01T09:00:00.000Z", text: "oldest" }),
        msg({ date: "2026-09-11T09:00:00.000Z", text: "newest" }),
      ],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    expect(state.messages[0].text).toBe("newest");
  });

  it("strips quoted text before the model sees it", () => {
    const state = buildJudgeState({
      subject: "s",
      messages: [msg({ text: "Following up.\n\nEmil\n\n> old thread\n> more" })],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    expect(state.messages[0].text).not.toContain("old thread");
  });

  it("truncates the whole state to the character budget", () => {
    const state = buildJudgeState({
      subject: "s",
      messages: Array.from({ length: 40 }, (_, i) =>
        msg({ date: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`, text: "x".repeat(500) }),
      ),
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    const chars = state.messages.reduce((n, m) => n + m.text.length, 0);
    expect(chars).toBeLessThanOrEqual(STATE_CHAR_BUDGET);
    expect(state.messages.length).toBeGreaterThan(0);
  });

  it("counts days since the founder's most recent message", () => {
    const state = buildJudgeState({
      subject: "s",
      messages: [msg({ date: "2026-09-10T09:00:00.000Z" })],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    expect(state.daysSinceLastSent).toBe(10);
  });

  it("has deterministic order for messages with identical dates", () => {
    const sharedDate = "2026-09-10T09:00:00.000Z";
    const state = buildJudgeState({
      subject: "s",
      messages: [
        msg({ date: sharedDate, text: "first in input" }),
        msg({ date: sharedDate, text: "second in input" }),
      ],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    // Deterministic: preserves input order when dates tie
    expect(state.messages[0].text).toBe("first in input");
    expect(state.messages[1].text).toBe("second in input");
  });

  it("always includes the first message, truncating if it exceeds the budget", () => {
    const longText = "x".repeat(20_000);
    const state = buildJudgeState({
      subject: "s",
      messages: [
        msg({ text: longText }),
        msg({ text: "second message" }),
      ],
      ownEmails: own,
      todayIso: "2026-09-20T09:00:00.000Z",
    });

    expect(state.messages.length).toBe(1);
    expect(state.messages[0].text.length).toBe(STATE_CHAR_BUDGET);
  });
});

describe("JUDGE_QUESTIONS", () => {
  it("keeps the urgency score inside Jev's 2-10 level range", () => {
    expect(JUDGE_QUESTIONS.urgency.criteria.length).toBe(URGENCY_LEVELS.length);
    expect(JUDGE_QUESTIONS.urgency.criteria.length).toBeGreaterThanOrEqual(2);
    expect(JUDGE_QUESTIONS.urgency.criteria.length).toBeLessThanOrEqual(10);
  });
});

describe("interpretJudgement", () => {
  it("includes and nudges when both probabilities clear the thresholds", () => {
    const j = interpretJudgement(answers());
    expect(j).toMatchObject({ source: "jev", included: true, needsNudge: true, urgency: "warm" });
    expect(j.nudgeProb).toBe(0.8);
  });

  it("excludes a thread below the outreach threshold", () => {
    const j = interpretJudgement(answers({ is_my_outreach: { type: "noul", noul: 0.49 } }));
    expect(j.included).toBe(false);
  });

  it("includes exactly at the outreach threshold", () => {
    const j = interpretJudgement(answers({ is_my_outreach: { type: "noul", noul: 0.5 } }));
    expect(j.included).toBe(true);
  });

  it("does not nudge a concluded thread", () => {
    const j = interpretJudgement(answers({ needs_nudge: { type: "noul", noul: 0.2 } }));
    expect(j.needsNudge).toBe(false);
  });

  it("rounds a fractional score to the nearest urgency level", () => {
    const score = (n: number): JevAnswer => ({
      type: "score", score: n, legend: {}, probabilities: {}, confidence: 0.9,
    });
    expect(interpretJudgement(answers({ urgency: score(0.2) })).urgency).toBe("dead");
    expect(interpretJudgement(answers({ urgency: score(2.6) })).urgency).toBe("hot");
  });

  it("clamps a score outside the legend rather than indexing past the end", () => {
    const j = interpretJudgement(answers({
      urgency: { type: "score", score: 99, legend: {}, probabilities: {}, confidence: 0.9 },
    }));
    expect(j.urgency).toBe("hot");
  });

  it("throws when an answer is missing, so the caller can fall back", () => {
    const partial = answers();
    delete partial.needs_nudge;
    expect(() => interpretJudgement(partial)).toThrow(JevError);
  });

  it("throws when an answer is the wrong primitive", () => {
    expect(() =>
      interpretJudgement(answers({ needs_nudge: { type: "choice", choice: "yes", probabilities: {}, confidence: 1 } })),
    ).toThrow(JevError);
  });
});

describe("heuristicJudgement", () => {
  it("carries the inclusion verdict and admits it cannot rank", () => {
    const j = heuristicJudgement({ included: true, reason: "subject" });
    expect(j).toEqual({
      source: "heuristic",
      included: true,
      needsNudge: true,
      urgency: null,
      outreachProb: null,
      nudgeProb: null,
    });
  });

  it("never nudges a thread it excluded", () => {
    expect(heuristicJudgement({ included: false, reason: "warming_label" }).needsNudge).toBe(false);
  });
});

describe("runJudge", () => {
  const state = {
    subject: "s", daysSinceLastSent: 9, messageCount: 1,
    messages: [{ author: "founder" as const, date: "2026-09-10T09:00:00.000Z", text: "hi" }],
  };

  const reply = {
    model: "jev-1.13.0",
    answers: answers(),
    usage: { input_tokens: 300, output_tokens: 10 },
  };

  it("returns one judgement per state, in order", async () => {
    const evaluate = vi.fn().mockResolvedValue(reply);
    const run = await runJudge([state, state], { evaluate });

    expect(run.judgements).toHaveLength(2);
    expect(run.judgements[0]?.source).toBe("jev");
    expect(run.judgements[1]?.urgency).toBe("warm");
  });

  it("totals input tokens and prices them", async () => {
    const evaluate = vi.fn().mockResolvedValue(reply);
    const run = await runJudge([state, state], { evaluate });

    expect(run.inputTokens).toBe(600);
    expect(run.costUSD).toBeCloseTo(600 * (0.042 / 1_000_000), 12);
  });

  it("yields null for a thread whose call failed, without failing the run", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const evaluate = vi
        .fn()
        .mockResolvedValueOnce(reply)
        .mockRejectedValueOnce(new JevError("jev 529"));

      const run = await runJudge([state, state], { evaluate });

      expect(run.judgements[0]?.source).toBe("jev");
      expect(run.judgements[1]).toBeNull();
      expect(run.failures).toBe(1);
      expect(errSpy).toHaveBeenCalledWith("[followups] jev judge failed:", "jev 529");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("yields null when the response parses but the answers are wrong", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const evaluate = vi.fn().mockResolvedValue({ ...reply, answers: {} });
      const run = await runJudge([state], { evaluate });

      expect(run.judgements[0]).toBeNull();
      expect(run.failures).toBe(1);
      expect(errSpy).toHaveBeenCalledWith("[followups] jev judge failed:", 'jev answer "is_my_outreach" was not a noul');
    } finally {
      errSpy.mockRestore();
    }
  });

  it("respects bounded concurrency", async () => {
    let maxConcurrency = 0;
    let currentConcurrency = 0;

    // Pre-allocate deferreds for each state
    const deferreds: Array<{ resolve: () => void; promise: Promise<void> }> = [];
    for (let i = 0; i < 30; i++) {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      deferreds.push({ resolve, promise });
    }

    let callIndex = 0;
    const evaluate = vi.fn(async (state, questions) => {
      const myCallIndex = callIndex++;
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);

      // Wait for this specific deferred to be resolved
      await deferreds[myCallIndex].promise;

      currentConcurrency--;
      return reply;
    });

    // Start the run with 30 states (more than JUDGE_CONCURRENCY)
    const runPromise = runJudge(Array(30).fill(state), { evaluate });

    // Spin until all JUDGE_CONCURRENCY workers have made their first call
    // Yield to the event loop to let workers progress
    while (callIndex < JUDGE_CONCURRENCY) {
      await Promise.resolve();
    }

    // Now all workers should be blocked on their deferreds
    // Resolve all deferreds to let them proceed
    for (const deferred of deferreds) {
      deferred.resolve();
    }

    const run = await runPromise;

    // Prove concurrency is real: more than one call was in flight
    expect(maxConcurrency).toBeGreaterThan(1);
    // Prove the bound is real: never exceeded JUDGE_CONCURRENCY
    expect(maxConcurrency).toBeLessThanOrEqual(JUDGE_CONCURRENCY);
    // Prove JUDGE_CONCURRENCY respects Jev's ceiling
    expect(JUDGE_CONCURRENCY).toBeLessThanOrEqual(20);
    // Verify we processed all states
    expect(run.judgements).toHaveLength(30);
  });
});
