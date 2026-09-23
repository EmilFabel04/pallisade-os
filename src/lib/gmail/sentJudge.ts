/* ============================================================
   The follow-up judge (pure half).

   sentScan.ts answers two questions with rules: did the founder write
   this (authorship), and who wrote last (order). Neither asks whether a
   follow-up is owed. This module asks that, via Jev, and keeps the same
   pure/IO split as its neighbour — everything here is testable without
   a network.
   ============================================================ */

import { JevError, type JevAnswer, type JevQuestion } from "@/lib/jev/types";
import { daysBetween, unquotedBody, isOwn, type InclusionResult, type ScanMessage } from "./sentScan";

/** Total thread text handed to Jev. Its limit is 32k tokens per question;
 *  6,000 characters is roughly 1.5k tokens, which leaves the questions and
 *  the envelope an order of magnitude of headroom. Raise this first if the
 *  model starts missing context that lives early in long threads. */
export const STATE_CHAR_BUDGET = 6_000;

/** Probability at or above which a thread counts as the founder's outreach.
 *  Lower it if genuine outreach is being excluded from the queue; raise it if
 *  newsletters, receipts, and automated notifications start slipping through. */
export const INCLUDE_NOUL_MIN = 0.5;

/** Probability at or above which a follow-up is owed.
 *  Lower it if threads that deserve a chase are being dropped from the nudge queue;
 *  raise it if concluded conversations (deals closed, declined, or meeting booked)
 *  keep resurfacing for follow-up. */
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

/**
 * Flatten one thread into the state Jev reads.
 *
 * Newest first, de-quoted with the same unquotedBody() the sign-off test uses,
 * and truncated by dropping whole messages from the tail — the first message
 * is always included (truncated if needed), and subsequent messages are dropped
 * whole if they exceed the budget. This ensures the model always sees at least
 * the full context of the most recent message.
 */
export function buildJudgeState(input: {
  subject: string;
  messages: ScanMessage[];
  ownEmails: Set<string>;
  todayIso: string;
}): JudgeState {
  const ordered = [...input.messages]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.date > b.m.date) return -1;
      if (a.m.date < b.m.date) return 1;
      return a.i - b.i; // Equal dates: preserve input order
    })
    .map((x) => x.m);

  const messages: JudgeState["messages"] = [];
  let used = 0;
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    const text = unquotedBody(m.text).trim();
    const isFirst = i === 0;

    // First message is always included, truncated if needed
    if (isFirst) {
      const truncated = text.length > STATE_CHAR_BUDGET ? text.slice(0, STATE_CHAR_BUDGET) : text;
      messages.push({
        author: isOwn(m.from, input.ownEmails) ? "founder" : "them",
        date: m.date,
        text: truncated,
      });
      used = truncated.length;
      continue;
    }

    // Subsequent messages: admit whole or not at all
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
