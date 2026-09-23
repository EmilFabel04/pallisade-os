# Jev Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sent-mail follow-up audit its first UI, ranked by a per-thread judgement from TypeSafe's Jev, with a keyword-heuristic fallback that never lets a vendor outage break the audit.

**Architecture:** A vendor-agnostic Jev client (`src/lib/jev/`) knows nothing about email. A judge module (`src/lib/gmail/sentJudge.ts`) keeps the repo's pure/IO split: pure state-building and interpretation, plus one bounded-concurrency fan-out. `auditSentFollowUps()` gains a judge mode and falls back per thread. Results persist to a server-owned table; the founder's handled/snoozed state persists as a normal client collection. One page at `/follow-ups` renders it.

**Tech Stack:** Next.js 15 App Router, TypeScript, vitest, `@libsql/client`, Tailwind v4, lucide-react. No new npm dependencies — Jev is called with plain `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-22-jev-followups-design.md`

## Global Constraints

- **No new npm dependency.** Jev is one endpoint: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer $TYPESAFE_API_KEY`. The published SDK's package name is ambiguous across sources; do not install it.
- **Env var name is `TYPESAFE_API_KEY`.** Absent key = heuristic mode, never an error.
- **Jev limits:** 64k context total, 32k per question, 1,200 req/min, 250k tokens/sec. Retry only `429` and `529`.
- **Price:** `$0.042 / 1_000_000` input tokens; output free. Cost is computed, never estimated in the UI.
- **`classifyThread` is not modified.** The bucket is a fact derived from message order; only provenance and need are judged.
- **Every test asserts resolved values, never declared configuration.** This repo has shipped green suites over dead code twice (`2026-08-04-content-studio-daily-engine-STATUS.md:115`). Tasks 2 and 4 end with a mutation check.
- **Run the whole suite with `npm test`; a single file with `npx vitest run <path>`.**

---

### Task 1: Jev client

Vendor surface only. No Gmail types reach this directory.

**Files:**
- Create: `src/lib/jev/types.ts`
- Create: `src/lib/jev/client.ts`
- Test: `src/lib/jev/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isConfigured(): boolean`, `evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse>`, `USD_PER_INPUT_TOKEN: number`, `JevError`, and the answer types below.

- [ ] **Step 1: Write the types**

Create `src/lib/jev/types.ts`:

```ts
/* ============================================================
   TypeSafe "System One" wire types (server-only).
   Mirrors the documented shape of POST /v1/systemone. Nothing
   in here knows about email, leads or this app.
   ============================================================ */

export interface JevNoulAnswer {
  type: "noul";
  /** Probability the statement is true, 0-1. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  /** Fractional position across the criteria levels, e.g. 1.05 on a 0-2 scale. */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
}

/** Every failure this client raises, so callers can catch one type and degrade. */
export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "JevError";
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/jev/client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluate, isConfigured, USD_PER_INPUT_TOKEN } from "@/lib/jev/client";
import { JevError } from "@/lib/jev/types";

const QUESTIONS = { is_urgent: { type: "noul", instructions: "Urgent?" } } as const;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const BODY = {
  model: "jev-1.13.0",
  answers: { is_urgent: { type: "noul", noul: 0.95 } },
  usage: { input_tokens: 307, output_tokens: 20 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isConfigured", () => {
  it("is false without a key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(isConfigured()).toBe(false);
  });

  it("is true with a key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    expect(isConfigured()).toBe(true);
  });
});

describe("evaluate", () => {
  it("posts state and questions and returns the parsed answers", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(ok(BODY));
    vi.stubGlobal("fetch", fetchMock);

    const res = await evaluate("payouts failing", QUESTIONS);

    expect(res.answers.is_urgent).toEqual({ type: "noul", noul: 0.95 });
    expect(res.usage.input_tokens).toBe(307);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(init.body as string);
    expect(sent.state).toBe("payouts failing");
    expect(sent.questions).toEqual(QUESTIONS);
  });

  it("throws without a key rather than calling out", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(JevError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 429 and returns the successful retry", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(ok(BODY));
    vi.stubGlobal("fetch", fetchMock);

    const res = await evaluate("x", QUESTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.answers.is_urgent).toEqual({ type: "noul", noul: 0.95 });
  });

  it("gives up after three attempts on a persistent 529", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("overloaded", { status: 529 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(/529/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad question", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(JevError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on a body that is not the documented shape", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ model: "jev", usage: {} })));

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(/answers/);
  });

  it("prices input tokens at the published rate", () => {
    expect(USD_PER_INPUT_TOKEN * 1_000_000).toBeCloseTo(0.042, 6);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/jev/client.test.ts`
Expected: FAIL — cannot resolve `@/lib/jev/client`.

- [ ] **Step 4: Write the client**

Create `src/lib/jev/client.ts`:

```ts
/* ============================================================
   TypeSafe Jev client (server-only).

   One endpoint, plain fetch, no SDK: the published package name is
   ambiguous across TypeSafe's own docs and the community guides, and a
   week-old dependency is not worth the risk for a single POST.

   Dormant until TYPESAFE_API_KEY exists, in the manner of gmail/config.ts —
   every consumer checks isConfigured() first and degrades rather than fails.
   ============================================================ */

import { JevError, type JevQuestion, type JevResponse } from "./types";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-latest";

/** Published rate: $0.042 per million input tokens. Output is free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** Only 429 and 529 are retried; everything else is a fact about the request. */
const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

export function isConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Evaluate one state against a set of typed questions.
 *
 * Jev answers every question in parallel against the same state, so callers
 * should batch their questions into one call rather than looping.
 */
export async function evaluate(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError("TYPESAFE_API_KEY is not set");

  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
      });
    } catch (e) {
      throw new JevError(`jev request failed: ${(e as Error).message}`);
    }

    if (res.ok) {
      const body = (await res.json().catch(() => null)) as JevResponse | null;
      if (!body || typeof body !== "object" || !body.answers) {
        throw new JevError("jev response carried no answers");
      }
      return body;
    }

    lastStatus = res.status;
    if (!RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
      const detail = await res.text().catch(() => "");
      throw new JevError(`jev ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    await sleep(BASE_DELAY_MS * 2 ** attempt);
  }

  throw new JevError(`jev ${lastStatus}: retries exhausted`, lastStatus);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/jev/client.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jev
git commit -m "feat(jev): client for the TypeSafe System One endpoint"
```

---

### Task 2: The pure judge

State building and interpretation. No IO, unit-tested the way `sentScan.ts` is.

**Files:**
- Create: `src/lib/gmail/sentJudge.ts`
- Test: `src/lib/gmail/sentJudge.test.ts`

**Interfaces:**
- Consumes: `JevAnswer`, `JevError` from Task 1; `ScanMessage`, `unquotedBody`, `InclusionResult` from `sentScan.ts`.
- Produces: `JudgeState`, `Urgency`, `ThreadJudgement`, `buildJudgeState()`, `JUDGE_QUESTIONS`, `interpretJudgement()`, `heuristicJudgement()`, and the constants `STATE_CHAR_BUDGET`, `INCLUDE_NOUL_MIN`, `NUDGE_NOUL_MIN`, `URGENCY_LEVELS`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/gmail/sentJudge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildJudgeState, interpretJudgement, heuristicJudgement,
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

    expect(state.messages.map((m) => m.author)).toEqual(["them", "founder"]);
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/gmail/sentJudge.test.ts`
Expected: FAIL — cannot resolve `@/lib/gmail/sentJudge`.

- [ ] **Step 3: Write the pure judge**

Create `src/lib/gmail/sentJudge.ts`:

```ts
/* ============================================================
   The follow-up judge (pure half).

   sentScan.ts answers two questions with rules: did the founder write
   this (authorship), and who wrote last (order). Neither asks whether a
   follow-up is owed. This module asks that, via Jev, and keeps the same
   pure/IO split as its neighbour — everything here is testable without
   a network.
   ============================================================ */

import { JevError, type JevAnswer, type JevQuestion } from "@/lib/jev/types";
import { unquotedBody, isOwn, type InclusionResult, type ScanMessage } from "./sentScan";

/** Total thread text handed to Jev. Its limit is 32k tokens per question;
 *  6,000 characters is roughly 1.5k tokens, which leaves the questions and
 *  the envelope an order of magnitude of headroom. Raise this first if the
 *  model starts missing context that lives early in long threads. */
export const STATE_CHAR_BUDGET = 6_000;

/** Probability at or above which a thread counts as the founder's outreach. */
export const INCLUDE_NOUL_MIN = 0.5;

/** Probability at or above which a follow-up is owed. */
export const NUDGE_NOUL_MIN = 0.5;

/** Ordered low → high; the array index is the Jev score legend index. */
export const URGENCY_LEVELS = ["dead", "low", "warm", "hot"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export interface JudgeState {
  subject: string;
  daysSinceLastSent: number;
  messageCount: number;
  /** Newest first. */
  messages: { author: "founder" | "them"; date: string; text: string }[];
}

export interface ThreadJudgement {
  source: "jev" | "heuristic";
  included: boolean;
  needsNudge: boolean;
  /** null from the heuristic, which has no notion of urgency. */
  urgency: Urgency | null;
  outreachProb: number | null;
  nudgeProb: number | null;
}

export const JUDGE_QUESTIONS: Record<string, JevQuestion> & {
  urgency: { type: "score"; instructions: string; criteria: string[] };
} = {
  is_my_outreach: {
    type: "noul",
    instructions:
      "This thread is genuine correspondence written by the founder to a real person — " +
      "not a newsletter, receipt, automated notification, calendar invite or internal note.",
  },
  needs_nudge: {
    type: "noul",
    instructions:
      "The founder owes this person a follow-up now. False when the conversation reached " +
      "a conclusion: the deal closed, they declined, or a meeting is already booked.",
  },
  urgency: {
    type: "score",
    instructions: "How much does chasing this thread today matter?",
    criteria: [
      "Dead — do not chase",
      "Low — chase when idle",
      "Warm — chase this week",
      "Hot — chase today",
    ],
  },
};

/** Whole days between two ISO dates, floored at 0. Mirrors sentScan's daysBetween. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Flatten one thread into the state Jev reads.
 *
 * Newest first, de-quoted with the same unquotedBody() the sign-off test uses,
 * and truncated by dropping whole messages from the tail — a half-sentence from
 * three months ago helps nobody, and whole messages keep the state honest.
 */
export function buildJudgeState(input: {
  subject: string;
  messages: ScanMessage[];
  ownEmails: Set<string>;
  todayIso: string;
}): JudgeState {
  const ordered = [...input.messages].sort((a, b) => (a.date < b.date ? 1 : -1));

  const messages: JudgeState["messages"] = [];
  let used = 0;
  for (const m of ordered) {
    const text = unquotedBody(m.text).trim();
    if (used + text.length > STATE_CHAR_BUDGET) break;
    used += text.length;
    messages.push({
      author: isOwn(m.from, input.ownEmails) ? "founder" : "them",
      date: m.date,
      text,
    });
  }

  const lastOwn = ordered.find((m) => isOwn(m.from, input.ownEmails));

  return {
    subject: input.subject,
    daysSinceLastSent: lastOwn ? daysBetween(lastOwn.date, input.todayIso) : 0,
    messageCount: input.messages.length,
    messages,
  };
}

function noul(answers: Record<string, JevAnswer>, key: string): number {
  const a = answers[key];
  if (!a || a.type !== "noul" || typeof a.noul !== "number") {
    throw new JevError(`jev answer "${key}" was not a noul`);
  }
  return a.noul;
}

/** Turn Jev's answers into a verdict. Throws JevError on anything unexpected,
 *  which is what lets the caller degrade one thread instead of a whole run. */
export function interpretJudgement(answers: Record<string, JevAnswer>): ThreadJudgement {
  const outreachProb = noul(answers, "is_my_outreach");
  const nudgeProb = noul(answers, "needs_nudge");

  const urgencyAnswer = answers.urgency;
  if (!urgencyAnswer || urgencyAnswer.type !== "score" || typeof urgencyAnswer.score !== "number") {
    throw new JevError('jev answer "urgency" was not a score');
  }

  const index = Math.min(
    URGENCY_LEVELS.length - 1,
    Math.max(0, Math.round(urgencyAnswer.score)),
  );

  return {
    source: "jev",
    included: outreachProb >= INCLUDE_NOUL_MIN,
    needsNudge: nudgeProb >= NUDGE_NOUL_MIN,
    urgency: URGENCY_LEVELS[index],
    outreachProb,
    nudgeProb,
  };
}

/** The keyword rule expressed as a judgement, for fallback and compare mode. */
export function heuristicJudgement(verdict: InclusionResult): ThreadJudgement {
  return {
    source: "heuristic",
    included: verdict.included,
    needsNudge: verdict.included,
    urgency: null,
    outreachProb: null,
    nudgeProb: null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/gmail/sentJudge.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Mutate the threshold and confirm a test dies**

Run: `./scripts/mutate.sh src/lib/gmail/sentJudge.ts 'outreachProb >= INCLUDE_NOUL_MIN' 'outreachProb > INCLUDE_NOUL_MIN'`
Expected: `KILLED`. A `SURVIVED` here means the boundary test never fired — fix the test, not the source.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gmail/sentJudge.ts src/lib/gmail/sentJudge.test.ts
git commit -m "feat(followups): pure Jev judge for sent-mail threads"
```

---

### Task 3: The judge fan-out

**Files:**
- Modify: `src/lib/gmail/sentJudge.ts` (append)
- Modify: `src/lib/gmail/sentJudge.test.ts` (append)

**Interfaces:**
- Consumes: `evaluate` from Task 1, `buildJudgeState` / `interpretJudgement` from Task 2.
- Produces: `JUDGE_CONCURRENCY`, `judgeOne(state, evaluate)` (note: NOT `judgeThread`, which is the existing heuristic in `sentScan.ts`), `JudgeRun`, `runJudge(states, deps?): Promise<JudgeRun>`.

`runJudge` takes its `evaluate` as an injected dependency so tests never touch the network and never stub globals.

- [ ] **Step 1: Write the failing test (append to `sentJudge.test.ts`)**

```ts
import { runJudge, JUDGE_CONCURRENCY } from "@/lib/gmail/sentJudge";

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
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(reply)
      .mockRejectedValueOnce(new JevError("jev 529"));

    const run = await runJudge([state, state], { evaluate });

    expect(run.judgements[0]?.source).toBe("jev");
    expect(run.judgements[1]).toBeNull();
    expect(run.failures).toBe(1);
  });

  it("yields null when the response parses but the answers are wrong", async () => {
    const evaluate = vi.fn().mockResolvedValue({ ...reply, answers: {} });
    const run = await runJudge([state], { evaluate });

    expect(run.judgements[0]).toBeNull();
    expect(run.failures).toBe(1);
  });

  it("stays under Jev's rate ceiling", () => {
    expect(JUDGE_CONCURRENCY).toBeLessThanOrEqual(20);
  });
});
```

Add `vi` to the vitest import at the top of the file: `import { describe, it, expect, vi } from "vitest";`

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/gmail/sentJudge.test.ts`
Expected: FAIL — `runJudge` is not exported.

- [ ] **Step 3: Append the fan-out to `sentJudge.ts`**

```ts
/* ---------------- fan-out (the only IO in this file) ---------------- */

import { evaluate as jevEvaluate, USD_PER_INPUT_TOKEN } from "@/lib/jev/client";
import type { JevResponse } from "@/lib/jev/types";

/** Jev allows 1,200 req/min (20/s). Twelve in flight stays clear of it while
 *  keeping a 400-thread scan bounded by Gmail rather than by us. */
export const JUDGE_CONCURRENCY = 12;

export interface JudgeRun {
  /** One entry per input state, positionally aligned. null = this thread failed. */
  judgements: (ThreadJudgement | null)[];
  inputTokens: number;
  costUSD: number;
  failures: number;
  calls: number;
}

type Evaluator = (
  state: unknown,
  questions: Record<string, JevQuestion>,
) => Promise<JevResponse>;

/** Judge one state. Any failure — transport, status, or a malformed body —
 *  surfaces as a thrown JevError for the caller to turn into a fallback. */
export async function judgeOne(state: JudgeState, evaluate: Evaluator): Promise<{
  judgement: ThreadJudgement;
  inputTokens: number;
}> {
  const res = await evaluate(state, JUDGE_QUESTIONS);
  return {
    judgement: interpretJudgement(res.answers),
    inputTokens: res.usage?.input_tokens ?? 0,
  };
}

/**
 * Judge many states with bounded concurrency.
 *
 * Never rejects: a thread that fails comes back null and is counted, so one
 * bad thread costs its own ranking and nothing else.
 */
export async function runJudge(
  states: JudgeState[],
  deps: { evaluate?: Evaluator } = {},
): Promise<JudgeRun> {
  const evaluate = deps.evaluate ?? jevEvaluate;
  const judgements: (ThreadJudgement | null)[] = new Array(states.length).fill(null);

  let inputTokens = 0;
  let failures = 0;
  let calls = 0;
  let next = 0;

  const workers = Array.from({ length: Math.min(JUDGE_CONCURRENCY, states.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= states.length) return;
      calls++;
      try {
        const { judgement, inputTokens: used } = await judgeOne(states[i], evaluate);
        judgements[i] = judgement;
        inputTokens += used;
      } catch {
        failures++;
      }
    }
  });

  await Promise.all(workers);

  return { judgements, inputTokens, costUSD: inputTokens * USD_PER_INPUT_TOKEN, failures, calls };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/gmail/sentJudge.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sentJudge.ts src/lib/gmail/sentJudge.test.ts
git commit -m "feat(followups): bounded-concurrency Jev fan-out"
```

---

### Task 4: Wire the judge into the audit

The behaviour change. Read `src/lib/gmail/sentAudit.ts:166-299` before starting.

**Files:**
- Modify: `src/lib/gmail/sentScan.ts` (`ScannedThread`, `FollowUp`, `groupByRecipient`)
- Modify: `src/lib/gmail/sentAudit.ts` (`SentAuditResult`, `auditSentFollowUps`)
- Test: `src/lib/gmail/sentAudit.test.ts` (create)
- Modify: `src/lib/gmail/sentScan.test.ts` (extend `groupByRecipient` coverage)

**Interfaces:**
- Consumes: `ThreadJudgement`, `buildJudgeState`, `runJudge`, `heuristicJudgement` from Tasks 2-3; `isConfigured` from Task 1.
- Produces: `JudgeMode = "jev" | "heuristic" | "both"`, `JudgeStats`, `auditSentFollowUps({query?, limit?, judge?, deps?})`, and `FollowUp.judgement` / `FollowUp.agrees`.

**Two behaviour decisions this task locks in:**

1. **Stalled threads.** Today every `stalled` thread is dropped unseen (`sentAudit.ts:267`). Under Jev, `needs_nudge` decides instead — a thread where the founder answered last and was then ignored for three weeks is exactly what the page should surface. Heuristic mode keeps dropping them, unchanged, because the heuristic has no opinion to offer.
2. **Inclusion.** In `jev` mode `is_my_outreach` replaces `judgeThread` outright, so the "subject contains Pallisade" rule stops being a guaranteed include.

- [ ] **Step 1: Extend the two pure types**

In `src/lib/gmail/sentScan.ts`, add to `ScannedThread` and `FollowUp`:

```ts
// in ScannedThread, after `recipients`:
  /** How this thread was judged. */
  judgement: ThreadJudgement;
  /** Compare mode only: did the two judges agree on inclusion? null otherwise. */
  agrees: boolean | null;
```

```ts
// in FollowUp, after `bucket`:
  judgement: ThreadJudgement;
  agrees: boolean | null;
```

Import the type at the top of `sentScan.ts`:

```ts
import type { ThreadJudgement } from "./sentJudge";
```

And carry both fields through `groupByRecipient`'s `latest.set(email, {...})` literal:

```ts
        judgement: t.judgement,
        agrees: t.agrees,
```

Then change the sort so a judged run ranks by urgency first, falling back to today's bucket order when nothing was ranked:

```ts
/** awaiting_you is the costlier miss, so it sorts first. */
const BUCKET_RANK: Record<ThreadBucket, number> = { awaiting_you: 0, no_reply: 1, stalled: 2 };

/** Highest urgency first; an unranked (heuristic) row sorts below every ranked one. */
const URGENCY_RANK: Record<string, number> = { hot: 0, warm: 1, low: 2, dead: 3 };
const urgencyRank = (f: FollowUp) =>
  f.judgement.urgency ? URGENCY_RANK[f.judgement.urgency] : 4;
```

```ts
  return [...latest.values()].sort(
    (a, b) =>
      urgencyRank(a) - urgencyRank(b) ||
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      b.daysSince - a.daysSince,
  );
```

- [ ] **Step 2: Add the ordering test to `sentScan.test.ts`**

```ts
import { heuristicJudgement } from "@/lib/gmail/sentJudge";
import type { ThreadJudgement } from "@/lib/gmail/sentJudge";

const judged = (urgency: ThreadJudgement["urgency"]): ThreadJudgement => ({
  source: "jev", included: true, needsNudge: true, urgency, outreachProb: 0.9, nudgeProb: 0.9,
});

describe("groupByRecipient ranking", () => {
  const thread = (email: string, urgency: ThreadJudgement["urgency"], lastSent: string): ScannedThread => ({
    threadId: `t-${email}`,
    subject: "s",
    bucket: "no_reply",
    lastSent,
    recipients: [{ name: email, email }],
    judgement: judged(urgency),
    agrees: null,
  });

  it("puts hot above warm regardless of age", () => {
    const rows = groupByRecipient(
      [
        thread("old@acme.co", "warm", "2026-08-01T09:00:00.000Z"),
        thread("new@acme.co", "hot", "2026-09-19T09:00:00.000Z"),
      ],
      new Set(["emil@pallisade.io"]),
      "2026-09-20T09:00:00.000Z",
    );

    expect(rows.map((r) => r.email)).toEqual(["new@acme.co", "old@acme.co"]);
  });

  it("sorts unranked heuristic rows below every ranked one", () => {
    const unranked: ScannedThread = {
      ...thread("plain@acme.co", null, "2026-09-19T09:00:00.000Z"),
      judgement: heuristicJudgement({ included: true, reason: "subject" }),
    };
    const rows = groupByRecipient(
      [unranked, thread("dead@acme.co", "dead", "2026-08-01T09:00:00.000Z")],
      new Set(["emil@pallisade.io"]),
      "2026-09-20T09:00:00.000Z",
    );

    expect(rows.map((r) => r.email)).toEqual(["dead@acme.co", "plain@acme.co"]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/gmail/sentScan.test.ts`
Expected: FAIL — existing `ScannedThread` fixtures in that file now lack `judgement` and `agrees`. Add `judgement: heuristicJudgement({ included: true, reason: "subject" }), agrees: null` to each existing fixture, then the two new tests should fail on ordering only.

- [ ] **Step 4: Apply Step 1's edits and re-run**

Run: `npx vitest run src/lib/gmail/sentScan.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the audit's options and result**

In `src/lib/gmail/sentAudit.ts`, add near the top:

```ts
import { isConfigured as jevConfigured } from "@/lib/jev/client";
import {
  buildJudgeState, heuristicJudgement, runJudge,
  type JudgeState, type ThreadJudgement,
} from "./sentJudge";

export type JudgeMode = "jev" | "heuristic" | "both";

export interface JudgeStats {
  mode: JudgeMode;
  /** Threads actually sent to Jev. */
  calls: number;
  /** Threads that fell back after a Jev failure. */
  failures: number;
  inputTokens: number;
  costUSD: number;
  ms: number;
  /** Compare mode only. */
  agreements: number;
  disagreements: number;
}
```

Add to `SentAuditResult`:

```ts
  judgeStats: JudgeStats;
  /** True when any thread fell back to the heuristic after a Jev failure. */
  degraded: boolean;
```

- [ ] **Step 6: Restructure the scan loop**

The loop currently judges and discards inside the per-thread pass. Jev needs a batch, so collect first and judge second. Replace the body of the per-thread `for (const raw of threads)` loop so that instead of calling `judgeThread` and `continue`-ing, it pushes a candidate:

```ts
      candidates.push({
        raw,
        messages,
        ourMessages,
        subject,
        labelNames: names,
        accountOwnEmails: new Set(ownEmails),
      });
```

Declare `const candidates: Candidate[] = [];` alongside `kept`, with:

```ts
interface Candidate {
  raw: RawThread;
  messages: ScanMessage[];
  ourMessages: ScanMessage[];
  subject: string;
  labelNames: string[];
  accountOwnEmails: Set<string>;
}
```

Then after the account loop, before `groupByRecipient`, judge them:

```ts
  const mode: JudgeMode = opts.judge ?? (jevConfigured() ? "jev" : "heuristic");
  const todayIso = new Date().toISOString();
  const startedAt = Date.now();

  // The heuristic verdict is always computed: it is the fallback, and in
  // compare mode it is the thing being compared against.
  const heuristicRaw = candidates.map((c) =>
    judgeThread({
      subject: c.subject,
      labelNames: c.labelNames,
      ownMessageBodies: c.ourMessages.map((m) => m.text),
    }),
  );
  const heuristicVerdicts = heuristicRaw.map(heuristicJudgement);

  let jevRun: Awaited<ReturnType<typeof runJudge>> | null = null;
  if (mode !== "heuristic" && candidates.length > 0) {
    const states: JudgeState[] = candidates.map((c) =>
      buildJudgeState({
        subject: c.subject,
        messages: c.messages,
        ownEmails: c.accountOwnEmails,
        todayIso,
      }),
    );
    jevRun = await (opts.deps?.runJudge ?? runJudge)(states);
  }

  let degraded = false;
  let agreements = 0;
  let disagreements = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const heuristic = heuristicVerdicts[i];
    const jev = jevRun?.judgements[i] ?? null;

    if (mode !== "heuristic" && !jev) degraded = true;

    const judgement: ThreadJudgement = jev ?? heuristic;

    let agrees: boolean | null = null;
    if (mode === "both" && jev) {
      agrees = jev.included === heuristic.included;
      if (agrees) agreements++;
      else disagreements++;
    }

    if (!judgement.included) {
      const { reason } = heuristicRaw[i];
      if (reason === "warming_label") excludedWarming++;
      else if (reason === "no_subject_no_signoff") excludedSignoffOnly++;
      continue;
    }

    const bucket = classifyThread(c.messages, c.accountOwnEmails);

    // Stalled threads were dropped unseen before there was anything able to
    // judge them. A Jev verdict is such a thing; the heuristic is not, so its
    // behaviour is unchanged.
    const dropStalled =
      bucket === "stalled" && (judgement.source === "heuristic" || !judgement.needsNudge);
    if (dropStalled) {
      stalledNotShown++;
      continue;
    }

    if (!judgement.needsNudge) {
      stalledNotShown++;
      continue;
    }

    const lastOurs = c.ourMessages.map((m) => m.date).sort().pop() ?? "";
    kept.push({
      threadId: c.raw.id,
      subject: c.subject || "(no subject)",
      bucket,
      lastSent: lastOurs,
      recipients: c.ourMessages.flatMap((m) => m.to),
      judgement,
      agrees,
    });
  }
```

Widen the signature and the return:

```ts
export async function auditSentFollowUps(
  opts: {
    query?: string;
    limit?: number;
    judge?: JudgeMode;
    /** Injected for tests; production uses the real fan-out. */
    deps?: { runJudge?: typeof runJudge };
  } = {},
): Promise<SentAuditResult> {
```

```ts
    judgeStats: {
      mode,
      calls: jevRun?.calls ?? 0,
      failures: jevRun?.failures ?? 0,
      inputTokens: jevRun?.inputTokens ?? 0,
      costUSD: jevRun?.costUSD ?? 0,
      ms: Date.now() - startedAt,
      agreements,
      disagreements,
    },
    degraded,
```

Also change `groupByRecipient(kept, ownEmails, new Date().toISOString())` to use `todayIso`.

- [ ] **Step 7: Write the audit test**

Create `src/lib/gmail/sentAudit.test.ts`. It stubs the Gmail modules so no network is touched, and asserts **resolved** values:

```ts
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
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lib/gmail/sentAudit.test.ts`
Expected: PASS, 7 tests. If the Gmail mocks misbehave, fix the mock — do not weaken an assertion to make it green.

- [ ] **Step 9: Mutate the fallback and confirm a test dies**

Run: `./scripts/mutate.sh src/lib/gmail/sentAudit.ts 'const judgement: ThreadJudgement = jev ?? heuristic;' 'const judgement: ThreadJudgement = heuristic;'`
Expected: `KILLED`. A `SURVIVED` means nothing asserts that a Jev verdict ever reaches a follow-up — precisely the defect this repo keeps shipping. Fix the test.

- [ ] **Step 10: Prove the advisor inherited the judge**

The spec's "one engine, both surfaces" decision holds by construction — `resolveEmailTool` passes no `judge`, so it takes the default. By construction is exactly how this repo has shipped dead capabilities before, so assert it. Append to `src/lib/gmail/sentAudit.test.ts`:

```ts
import { resolveEmailTool } from "@/lib/gmail/advisorEmail";

describe("the advisor's audit tool", () => {
  it("returns Jev-judged follow-ups, not the bare heuristic", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const payload = JSON.parse(await resolveEmailTool("audit_sent_followups", { limit: 10 }));

    expect(payload.judgeStats.mode).toBe("jev");
    expect(payload.followUps[0]).toHaveProperty("judgement");
  });
});
```

This calls the real fan-out, so stub the Jev client alongside the Gmail mocks at the top of the file:

```ts
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
```

Run: `npx vitest run src/lib/gmail/sentAudit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 11: Run the whole suite**

Run: `npm test`
Expected: PASS. Anything red here is a fixture that needs `judgement` / `agrees` added.

- [ ] **Step 12: Commit**

```bash
git add src/lib/gmail
git commit -m "feat(followups): judge the sent-mail audit with Jev, falling back per thread"
```

---

### Task 5: Persistence

**Files:**
- Modify: `src/lib/types.ts` (`FollowUpState`, `FollowUpRun`, `DataShape`, `SearchHit` exclusion, `AdvisorSnapshot` omission)
- Modify: `src/lib/db/sqlite.ts` (`COLLECTIONS`)
- Modify: `src/lib/store.tsx:107`, `src/lib/seed.ts:878`, `src/lib/db/apiAdapter.ts:61` (empty-shape literals)
- Create: `src/lib/gmail/followUpRuns.ts`
- Test: `src/lib/gmail/followUpRuns.test.ts`

**Interfaces:**
- Consumes: `SentAuditResult` from Task 4.
- Produces: `FollowUpState`, `FollowUpRun`, `RUN_HISTORY`, `saveRun()`, `latestRun()`, `listRuns()`.

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, before `DataShape`:

```ts
/** The founder's own disposition of a recipient. Client-authored, so it lives
 *  in COLLECTIONS; the audit itself does not write here. */
export interface FollowUpState {
  id: string;
  /** Lowercased recipient address this applies to. */
  email: string;
  status: "handled" | "snoozed";
  /** ISO date a snooze expires. null for "handled". */
  until: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One stored audit run. Server-authored — deliberately not in COLLECTIONS. */
export interface FollowUpRun {
  id: string;
  /** ISO timestamp the run finished. */
  at: string;
  result: SentAuditResult;
}
```

Import the result type at the top of `types.ts`:

```ts
import type { SentAuditResult } from "@/lib/gmail/sentAudit";
```

It must be `import type`. `sentAudit.ts` pulls in the Gmail client transitively, and `types.ts` is imported by client components — a value import here would drag `google-auth-library` into the browser bundle. The type-only form is erased at compile time, so the cycle it creates costs nothing.

Add to `DataShape`, after `comparables`:

```ts
  followUpState: FollowUpState[];
```

Keep it out of search and out of the advisor's picture:

```ts
export type CollectionKey = Exclude<keyof DataShape, "settings">;
```
stays as-is, but `SearchHit`'s kind in `src/lib/store.tsx:57` becomes:

```ts
  kind: Exclude<CollectionKey, "metricEntries" | "followUpState"> | "painPoints";
```

and `AdvisorSnapshot`'s omission list in `types.ts:658` gains `| "followUpState"` — the founder's dismissals are not sales context, and leaving it in would break every advisor test fixture for no gain.

- [ ] **Step 2: Register the collection and fix the empty shapes**

Add `"followUpState",` to the end of `COLLECTIONS` in `src/lib/db/sqlite.ts`, then add `followUpState: [],` to the empty-data literals at `src/lib/store.tsx:107`, `src/lib/seed.ts:878` and `src/lib/db/apiAdapter.ts:61`.

- [ ] **Step 3: Typecheck and fix whatever else the compiler names**

Run: `npx tsc --noEmit`
Expected: errors only for `DataShape` literals missing `followUpState`. `src/lib/reconcile.test.ts:27` is the likely remaining one. Add `followUpState: [],` to each until clean.

- [ ] **Step 4: Write the failing store test**

Create `src/lib/gmail/followUpRuns.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: { id: string; at: string; json: string }[] = [];

vi.mock("@/lib/db/client", () => ({
  getClient: () => ({
    batch: vi.fn(async () => {}),
    execute: vi.fn(async (stmt: { sql: string; args: unknown[] }) => {
      if (stmt.sql.startsWith("INSERT")) {
        rows.unshift({ id: stmt.args[0] as string, at: stmt.args[1] as string, json: stmt.args[2] as string });
        return { rows: [] };
      }
      if (stmt.sql.startsWith("DELETE")) {
        const keep = rows.slice(0, stmt.args[0] as number);
        rows.length = 0;
        rows.push(...keep);
        return { rows: [] };
      }
      const limit = (stmt.args[0] as number) ?? rows.length;
      return { rows: rows.slice(0, limit).map((r) => ({ json: r.json })) };
    }),
  }),
}));

import { saveRun, latestRun, listRuns, RUN_HISTORY } from "@/lib/gmail/followUpRuns";
import type { FollowUpRun } from "@/lib/types";

const run = (id: string, at: string): FollowUpRun => ({
  id,
  at,
  result: { scanned: 1, matched: 1, followUps: [] } as unknown as FollowUpRun["result"],
});

beforeEach(() => { rows.length = 0; });

describe("followUpRuns", () => {
  it("returns the run it just stored", async () => {
    await saveRun(run("r1", "2026-09-20T09:00:00.000Z"));
    const latest = await latestRun();
    expect(latest?.id).toBe("r1");
  });

  it("returns null when nothing has been stored", async () => {
    expect(await latestRun()).toBeNull();
  });

  it("hands back the newest run first", async () => {
    await saveRun(run("r1", "2026-09-19T09:00:00.000Z"));
    await saveRun(run("r2", "2026-09-20T09:00:00.000Z"));
    const all = await listRuns();
    expect(all.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("keeps ten runs of history", () => {
    expect(RUN_HISTORY).toBe(10);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npx vitest run src/lib/gmail/followUpRuns.test.ts`
Expected: FAIL — cannot resolve `@/lib/gmail/followUpRuns`.

- [ ] **Step 6: Write the store**

Create `src/lib/gmail/followUpRuns.ts`:

```ts
/* ============================================================
   Stored follow-up audit runs (server-only).

   Deliberately NOT in the COLLECTIONS array in src/lib/db/sqlite.ts, for
   the reason content/daily/store.ts documents: saveAll() deletes and
   reinserts every listed collection from a client snapshot, so a browser
   tab opened before a run would wipe it. The audit owns this table.

   History exists so compare mode has a sample. One run is a screenshot;
   ten is enough to judge whether Jev and the keyword rule actually differ.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import type { FollowUpRun } from "@/lib/types";

export const RUN_HISTORY = 10;

let schemaReady: Promise<void> | null = null;

export async function ensureFollowUpSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  // Identity-checked clear, as in content/daily/store.ts: one SQLITE_BUSY
  // must not poison this promise for the life of the process.
  const attempt: Promise<void> = (async () => {
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS followUpRuns (
                id         TEXT PRIMARY KEY,
                at         TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_followUpRuns_at ON followUpRuns(at)`, args: [] },
    ];
    await getClient().batch(stmts, "write");
  })().catch((err: unknown) => {
    if (schemaReady === attempt) schemaReady = null;
    throw err;
  });

  schemaReady = attempt;
  return schemaReady;
}

export async function saveRun(run: FollowUpRun): Promise<void> {
  await ensureFollowUpSchema();
  const client = getClient();

  await client.execute({
    sql: `INSERT INTO followUpRuns (id, at, json, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET at = excluded.at, json = excluded.json,
                                        updated_at = excluded.updated_at`,
    args: [run.id, run.at, JSON.stringify(run), run.at],
  });

  await client.execute({
    sql: `DELETE FROM followUpRuns WHERE id NOT IN (
            SELECT id FROM followUpRuns ORDER BY at DESC LIMIT ?
          )`,
    args: [RUN_HISTORY],
  });
}

export async function listRuns(limit = RUN_HISTORY): Promise<FollowUpRun[]> {
  await ensureFollowUpSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM followUpRuns ORDER BY at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => JSON.parse(r.json as string) as FollowUpRun);
}

export async function latestRun(): Promise<FollowUpRun | null> {
  const [first] = await listRuns(1);
  return first ?? null;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/gmail/followUpRuns.test.ts && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/db src/lib/store.tsx src/lib/seed.ts src/lib/gmail/followUpRuns.ts src/lib/gmail/followUpRuns.test.ts
git commit -m "feat(followups): persist audit runs and the founder's dismissals"
```

---

### Task 6: API routes

**Files:**
- Create: `src/app/api/followups/route.ts`
- Create: `src/app/api/followups/run/route.ts`
- Test: `src/app/api/followups/run/route.test.ts`

**Interfaces:**
- Consumes: `auditSentFollowUps`, `JudgeMode` (Task 4); `saveRun`, `latestRun` (Task 5); `isConfigured` from `@/lib/jev/client` and `@/lib/gmail/config`.
- Produces: `GET /api/followups` → `{ configured: { gmail, jev }, run: FollowUpRun | null }`; `POST /api/followups/run` → `FollowUpRun`.

Read `src/app/api/transcribe/route.ts` first — it is the shortest example of this repo's route conventions (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, a `GET` that reports configuration, `apiError` for upstream failures).

- [ ] **Step 1: Write the status route**

Create `src/app/api/followups/route.ts`:

```ts
import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { isConfigured as jevConfigured } from "@/lib/jev/client";
import { latestRun } from "@/lib/gmail/followUpRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The page's first paint: what is connected, and the last run if there is one. */
export async function GET() {
  try {
    return NextResponse.json({
      configured: { gmail: gmailConfigured(), jev: jevConfigured() },
      run: await latestRun(),
    });
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
```

- [ ] **Step 2: Write the failing run-route test**

Create `src/app/api/followups/run/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const audit = vi.fn();
const saveRun = vi.fn();

vi.mock("@/lib/gmail/sentAudit", () => ({ auditSentFollowUps: audit }));
vi.mock("@/lib/gmail/followUpRuns", () => ({ saveRun }));
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
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/app/api/followups/run/route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 4: Write the run route**

Create `src/app/api/followups/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { auditSentFollowUps, type JudgeMode } from "@/lib/gmail/sentAudit";
import { saveRun } from "@/lib/gmail/followUpRuns";
import { uid, nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: JudgeMode[] = ["jev", "heuristic", "both"];

/** Run the audit, store it, hand it back. Synchronous on purpose: the wall
 *  clock is Gmail's, and a single-user app does not need a job queue. */
export async function POST(req: Request) {
  if (!gmailConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }

  let body: { limit?: number; judge?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.judge != null && !MODES.includes(body.judge as JudgeMode)) {
    return NextResponse.json({ error: "bad_judge_mode" }, { status: 400 });
  }

  try {
    const result = await auditSentFollowUps({
      limit: body.limit,
      judge: body.judge as JudgeMode | undefined,
    });
    const run = { id: uid(), at: nowISO(), result };
    await saveRun(run);
    return NextResponse.json(run);
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/api/followups/run/route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/followups
git commit -m "feat(followups): status and run routes"
```

---

### Task 7: The page

**Files:**
- Create: `src/app/follow-ups/page.tsx`
- Create: `src/components/followups/FollowUpRow.tsx`
- Create: `src/components/followups/ComparePanel.tsx`
- Modify: `src/components/layout/nav.ts`

**Interfaces:**
- Consumes: the two routes from Task 6; `FollowUp` and `ThreadJudgement` types; `useStore` for `followUpState`.
- Produces: the `/follow-ups` route.

Read `src/app/inbox/page.tsx` first — it is the closest analogue (a Gmail-backed client page with a status fetch, a list, and per-row actions) and the source of `buildInteraction` usage.

- [ ] **Step 1: Add the nav entry**

In `src/components/layout/nav.ts`, add `MailWarning` to the lucide import and this entry directly after the `/inbox` line, keeping it in the Pipeline group:

```ts
  { href: "/follow-ups", label: "Follow-ups", icon: MailWarning, group: "Pipeline" },
```

- [ ] **Step 2: Build the row component**

Create `src/components/followups/FollowUpRow.tsx`. It renders one recipient and is presentational — every action is a callback, so the page owns all state:

```tsx
"use client";

import { Mail, Check, Clock, AlertTriangle, PhoneCall, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FollowUp } from "@/lib/gmail/sentScan";

const URGENCY_DOT: Record<string, string> = {
  hot: "bg-[var(--accent)]",
  warm: "bg-amber-400",
  low: "bg-neutral-500",
  dead: "bg-neutral-700",
};

const BUCKET_LABEL: Record<string, string> = {
  no_reply: "no reply",
  awaiting_you: "awaiting you",
  stalled: "stalled",
};

export function FollowUpRow(props: {
  followUp: FollowUp;
  compare: boolean;
  onOpen: () => void;
  onLog: () => void;
  onTask: () => void;
  onHandled: () => void;
  onSnooze: () => void;
}) {
  const { followUp: f } = props;
  const prob = f.judgement.nudgeProb;

  return (
    <div className="flex items-start gap-3 border-b border-[var(--hairline)] px-4 py-3">
      <span
        className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", URGENCY_DOT[f.judgement.urgency ?? "low"])}
        title={f.judgement.urgency ?? "unranked"}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{f.name}</span>
          <span className="truncate text-xs text-[var(--muted)]">{f.company}</span>
        </div>
        <div className="truncate text-xs text-[var(--muted)]">{f.subject}</div>

        {props.compare && f.agrees === false && (
          <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            disagrees — heuristic said {f.judgement.included ? "skip" : "follow up"}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted)]">
        <span>{BUCKET_LABEL[f.bucket]}</span>
        <span className="font-mono">{f.daysSince}d</span>
        <span className="font-mono">{prob == null ? "—" : prob.toFixed(2)}</span>
        <button onClick={props.onOpen} title="Open in inbox" className="hover:text-[var(--fg)]">
          <Mail className="h-4 w-4" />
        </button>
        <button onClick={props.onLog} title="Log an interaction" className="hover:text-[var(--fg)]">
          <PhoneCall className="h-4 w-4" />
        </button>
        <button onClick={props.onTask} title="Create a task" className="hover:text-[var(--fg)]">
          <ListChecks className="h-4 w-4" />
        </button>
        <button onClick={props.onSnooze} title="Snooze 7 days" className="hover:text-[var(--fg)]">
          <Clock className="h-4 w-4" />
        </button>
        <button onClick={props.onHandled} title="Mark handled" className="hover:text-[var(--fg)]">
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the compare panel**

Create `src/components/followups/ComparePanel.tsx`:

```tsx
"use client";

import { Panel } from "@/components/ui/Panel";
import type { JudgeStats } from "@/lib/gmail/sentAudit";

export function ComparePanel({ stats }: { stats: JudgeStats }) {
  const total = stats.agreements + stats.disagreements;

  return (
    <Panel title="Judge comparison">
      <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
        <Stat label="agree" value={String(stats.agreements)} />
        <Stat label="disagree" value={String(stats.disagreements)} />
        <Stat
          label="agreement"
          value={total === 0 ? "—" : `${Math.round((stats.agreements / total) * 100)}%`}
        />
      </div>
      <p className="px-4 pb-3 text-xs text-[var(--muted)]">
        Jev judged {stats.calls} threads in {(stats.ms / 1000).toFixed(1)}s for{" "}
        {(stats.costUSD * 100).toFixed(2)}¢
        {stats.failures > 0 && ` · ${stats.failures} fell back to the keyword rule`}
      </p>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-lg">{value}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Build the page**

Create `src/app/follow-ups/page.tsx`. Key behaviours: fetch status on mount, run on demand, hide recipients whose `followUpState` says handled or is snoozed until a future date, and surface `capped` / `degraded` honestly.

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MailWarning, Loader2, RefreshCw, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { FollowUpRow } from "@/components/followups/FollowUpRow";
import { ComparePanel } from "@/components/followups/ComparePanel";
import { addDaysISO, nowISO } from "@/lib/utils";
import { buildInteraction } from "@/lib/advisor/applyAction";
import type { FollowUpRun } from "@/lib/types";

const SCAN_SIZES = [50, 150, 400];

export default function FollowUpsPage() {
  const store = useStore();
  const router = useRouter();

  const [configured, setConfigured] = useState<{ gmail: boolean; jev: boolean } | null>(null);
  const [run, setRun] = useState<FollowUpRun | null>(null);
  const [limit, setLimit] = useState(150);
  const [compare, setCompare] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/followups")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(d.configured);
        setRun(d.run ?? null);
      })
      .catch(() => setError("Could not read the follow-up status."));
  }, []);

  const runAudit = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/followups/run", {
        method: "POST",
        body: JSON.stringify({ limit, judge: compare ? "both" : undefined }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setRun(await res.json());
    } catch {
      setError("The audit failed. Your inboxes may need reconnecting.");
    } finally {
      setRunning(false);
    }
  }, [limit, compare]);

  const dismissed = useMemo(() => {
    const today = nowISO();
    return new Set(
      store.followUpState
        .filter((s) => s.status === "handled" || (s.until ?? "") > today)
        .map((s) => s.email),
    );
  }, [store.followUpState]);

  const rows = (run?.result.followUps ?? []).filter((f) => !dismissed.has(f.email));
  const stats = run?.result.judgeStats;

  const dismiss = (email: string, status: "handled" | "snoozed") => {
    const existing = store.followUpState.find((s) => s.email === email);
    const patch = { status, until: status === "snoozed" ? addDaysISO(nowISO(), 7) : null };
    if (existing) store.update("followUpState", existing.id, patch);
    else store.create("followUpState", { email, ...patch });
  };

  const logInteraction = (f: (typeof rows)[number]) => {
    const created = store.create(
      "interactions",
      buildInteraction({
        company: f.company,
        contact: f.name,
        rawNotes: `Follow-up on "${f.subject}" — ${f.daysSince} days since my last message.`,
        followUpRequired: true,
      }),
    );
    router.push(`/interactions?focus=${created.id}`);
  };

  const createTask = (f: (typeof rows)[number]) => {
    store.create("tasks", {
      title: `Follow up with ${f.name} (${f.company})`,
      category: "sales",
      priority: f.judgement.urgency === "hot" ? "high" : "medium",
      status: "not started",
      dueDate: nowISO().slice(0, 10),
      notes: f.subject,
      linkKind: "none",
      linkId: null,
      milestoneId: null,
    });
  };

  if (configured && !configured.gmail) {
    return (
      <>
        <PageHeader title="Follow-ups" subtitle="Who is owed a reply, judged per thread." />
        <EmptyState
          icon={MailWarning}
          title="No inbox connected"
          message="Connect a Gmail account on the Inbox page and the audit can read your sent mail."
          action={
            <button onClick={() => router.push("/inbox")} className="btn">
              Go to Inbox
            </button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Who is owed a reply, judged per thread." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="border border-[var(--hairline)] bg-transparent px-2 py-1 text-sm"
        >
          {SCAN_SIZES.map((n) => (
            <option key={n} value={n}>{n} threads</option>
          ))}
        </select>

        <button
          onClick={runAudit}
          disabled={running}
          className="flex items-center gap-2 border border-[var(--hairline)] px-3 py-1 text-sm hover:border-[var(--accent)]"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {running ? "Scanning…" : "Run audit"}
        </button>

        <button
          onClick={() => setCompare((c) => !c)}
          className={`flex items-center gap-2 border px-3 py-1 text-sm ${
            compare ? "border-[var(--accent)]" : "border-[var(--hairline)]"
          }`}
        >
          <ArrowLeftRight className="h-4 w-4" />
          Compare
        </button>
      </div>

      {configured && !configured.jev && (
        <p className="mb-4 text-xs text-[var(--muted)]">
          Ranking is off — running the keyword heuristic. Add TYPESAFE_API_KEY to rank by urgency.
        </p>
      )}

      {error && <p className="mb-4 text-xs text-[var(--accent)]">{error}</p>}

      {stats && (
        <p className="mb-4 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <span>scanned {run?.result.scanned}</span>
          <span>{rows.length} owed a reply</span>
          <span className="font-mono">{(stats.costUSD * 100).toFixed(2)}¢</span>
          <span className="font-mono">{(stats.ms / 1000).toFixed(1)}s</span>
          {run?.result.degraded && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {stats.failures} judged by the keyword rule
            </span>
          )}
          {run?.result.capped && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              partial scan ({run.result.cappedReasons.join(", ")})
            </span>
          )}
        </p>
      )}

      {compare && stats && <div className="mb-4"><ComparePanel stats={stats} /></div>}

      <Panel title="Owed a reply" noPad>
        {rows.length === 0 ? (
          <EmptyState
            icon={MailWarning}
            title={run ? "Nobody is waiting on you" : "No audit yet"}
            message={run ? "Every thread in the last scan is handled." : "Run an audit to scan your sent mail."}
          />
        ) : (
          rows.map((f) => (
            <FollowUpRow
              key={f.email}
              followUp={f}
              compare={compare}
              onOpen={() => router.push("/inbox")}
              onLog={() => logInteraction(f)}
              onTask={() => createTask(f)}
              onHandled={() => dismiss(f.email, "handled")}
              onSnooze={() => dismiss(f.email, "snoozed")}
            />
          ))
        )}
      </Panel>
    </>
  );
}
```

- [ ] **Step 5: Check the shared-component contracts**

These are the real signatures as of this branch; the code above already matches them. Confirm they have not moved before debugging anything else:

- `PageHeader({ title, subtitle?, actions? })` — takes **no** `icon` prop.
- `EmptyState({ icon, title, message, action? })` — `icon` is **required** and is a `LucideIcon`; the body prop is `message`, not `body`; `action` is a `ReactNode`, not a `{label, onClick}` object.
- `Panel({ title?, action?, href?, children, className?, bodyClassName?, noPad? })` — the row list passes `noPad` so rows meet the panel edge.
- `buildInteraction(args)` returns a `New<Interaction>` suitable for `store.create("interactions", …)` and defaults `type` to `"discovery call"` when omitted.
- `uid`, `nowISO` and `addDaysISO(iso, days)` are all exported from `src/lib/utils`.

Do not change a shared component to fit this page.

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Look at it**

Run: `npm run dev`, open `http://localhost:3000/follow-ups`. With no `TYPESAFE_API_KEY` set, confirm the heuristic banner shows and a run still returns rows. With the key set, confirm rows carry an urgency dot and a probability, and that the cost reads in the region of 1-2¢ for 150 threads.

- [ ] **Step 9: Commit**

```bash
git add src/app/follow-ups src/components/followups src/components/layout/nav.ts
git commit -m "feat(followups): the Follow-ups page"
```

---

### Task 8: Record the branch status

**Files:**
- Create: `docs/superpowers/plans/2026-09-22-jev-followups-STATUS.md`
- Modify: `README.md` (route table)
- Modify: `DEPLOY.md` (env vars)

- [ ] **Step 1: Document the new env var**

Add `TYPESAFE_API_KEY` to `DEPLOY.md` beside the other keys, noting it is optional and that its absence degrades ranking rather than breaking the audit.

- [ ] **Step 2: Add the route to the README table**

```markdown
| `/follow-ups`    | Who is owed a reply, judged and ranked per thread by Jev        |
```

- [ ] **Step 3: Write the STATUS file**

Follow `docs/superpowers/plans/2026-08-19-fathom-tools-STATUS.md`. Record: what shipped, the two behaviour changes from Task 4 (stalled threads now judgeable, `judgeThread` no longer a guaranteed include), the mutation results from Tasks 2 and 4, and the first real-run numbers from Task 7 Step 8 — scanned, owed, cost, elapsed, and how many disagreements compare mode found.

- [ ] **Step 4: Commit**

```bash
git add docs README.md DEPLOY.md
git commit -m "docs(followups): status for the Jev-judged follow-up page"
```
