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
