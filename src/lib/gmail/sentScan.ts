/* ============================================================
   Pure filtering logic for the sent-mail follow-up audit.
   No I/O — unit-tested. Mirrors the parse.ts convention.
   ============================================================ */

import type { MailAddress } from "./parse";
import { companyFromEmail } from "./parse";
import type { ThreadJudgement } from "./sentJudge";

/** Gmail label whose threads are Apollo mailwarming traffic, never real outreach. */
export const WARMING_LABEL = "Apollo Mailwarming";

/** A subject containing this counts as the founder's own outreach. */
export const SUBJECT_KEYWORD = "Pallisade";

/** Accepted sign-offs, lowercased. */
export const SIGNOFF_NAMES = ["emil", "emil fabel"];

/** How many trailing non-empty lines the sign-off test inspects.
 *  1 = strict last line, chosen deliberately. Raising this to ~4 turns the test
 *  into a signature-block scan (matching a name above a title line) and is the
 *  single value to change if the strict rule under-matches in practice. */
export const SIGNOFF_SEARCH_LINES = 1;

/** Common valedictions stripped when they share a line with the name. */
const VALEDICTION =
  /^(best regards|kind regards|all the best|thank you|best|thanks|cheers|regards|warmly|sincerely)\s*[,\-–—]?\s*/i;

/** Regex for lines starting with >, which are filtered from the body. */
const QUOTED_LINE = /^>/;

/** Attribution markers that indicate a quoted thread should be truncated at this point. */
const ATTRIBUTION_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}$/i,
];

/**
 * Return only the newly-written part of a message body, removing both quoted
 * threads and interleaved quoted lines. Conservative on purpose: over-aggressive
 * stripping would discard a real signature and break the sign-off test.
 *
 * Strategy:
 * 1. Truncate at the first attribution marker (Gmail's "On...wrote:", Outlook's
 *    "-----Original Message-----", or "From:/Sent:" blocks). These precede
 *    trailing quote blocks, so truncation is safe.
 * 2. Filter out any lines starting with > (quoted lines), even if they appear
 *    mid-body as testimonials or interleaved replies.
 */
export function unquotedBody(text: string): string {
  const lines = text.split(/\r?\n/);
  let truncateAt = lines.length; // Default: don't truncate

  // Find the first attribution marker (truncate, not filter)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Outlook-style divider
    if (ATTRIBUTION_MARKERS.some((re) => re.test(line))) {
      truncateAt = i;
      break;
    }

    // Gmail attribution: "On <date> Name <addr> wrote:" — sometimes wrapped so
    // that "wrote:" lands on the following line.
    if (/^on\b/i.test(line)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/wrote:\s*$/i.test(line) || /^wrote:\s*$/i.test(next)) {
        truncateAt = i;
        break;
      }
    }

    // Outlook-style header block: a From: line immediately followed by Sent:/Date:.
    // A lone From: line is left alone — it appears in ordinary prose.
    if (/^from:\s/i.test(line) && /^(sent|date):\s/i.test((lines[i + 1] ?? "").trim())) {
      truncateAt = i;
      break;
    }
  }

  // Take the lines before the first attribution marker
  const truncated = lines.slice(0, truncateAt);

  // Filter out quoted lines (lines starting with > after trimming)
  const filtered = truncated.filter((line) => !QUOTED_LINE.test(line.trim()));

  return filtered.join("\n");
}

/** Trim a line to a bare name for comparison. */
function normalizeSignoff(line: string): string {
  return line
    .trim()
    .replace(VALEDICTION, "")
    .replace(/[.,;:!\-–—]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * True when the founder's own text ends with his sign-off.
 * Strict by design: inspects only the last SIGNOFF_SEARCH_LINES non-empty lines
 * of the unquoted body.
 */
export function signedByFounder(body: string): boolean {
  const lines = unquotedBody(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines
    .slice(-SIGNOFF_SEARCH_LINES)
    .some((l) => SIGNOFF_NAMES.includes(normalizeSignoff(l)));
}

export type InclusionReason = "warming_label" | "subject" | "signoff" | "no_subject_no_signoff";

export interface InclusionInput {
  subject: string;
  /** Resolved Gmail label *names* on the thread (not label ids). */
  labelNames: string[];
  /** Bodies of the messages the founder himself sent in this thread. */
  ownMessageBodies: string[];
}

export interface InclusionResult {
  included: boolean;
  reason: InclusionReason;
}

/**
 * Apply the inclusion rule: not warming-labelled, AND (subject keyword OR the
 * founder signed off). `reason` doubles as the diagnostic —
 * "no_subject_no_signoff" is exactly the set that a looser sign-off rule would
 * start admitting.
 */
export function judgeThread(input: InclusionInput): InclusionResult {
  if (input.labelNames.some((n) => n.toLowerCase() === WARMING_LABEL.toLowerCase())) {
    return { included: false, reason: "warming_label" };
  }

  if (input.subject.toLowerCase().includes(SUBJECT_KEYWORD.toLowerCase())) {
    return { included: true, reason: "subject" };
  }

  if (input.ownMessageBodies.some((b) => signedByFounder(b))) {
    return { included: true, reason: "signoff" };
  }

  return { included: false, reason: "no_subject_no_signoff" };
}

export type ThreadBucket = "no_reply" | "awaiting_you" | "stalled";

export interface ScanMessage {
  from: string;
  /** Full addresses, names preserved — the audit surfaces these to the founder. */
  to: MailAddress[];
  /** ISO date string. */
  date: string;
  text: string;
}

/** True when an address belongs to one of the founder's connected inboxes. */
export function isOwn(email: string, ownEmails: Set<string>): boolean {
  return ownEmails.has(email.trim().toLowerCase());
}

/**
 * Work out where a thread stands.
 *   no_reply     — nobody but the founder ever wrote
 *   awaiting_you — the other side wrote last; the ball is in his court
 *   stalled      — they replied, but the founder answered last
 *
 * When any message carries an empty date, the entire thread falls back to the
 * caller's original message order (which Gmail's threads.get returns chronologically).
 * This ensures a total, deterministic order: mixing date-based and index-based
 * comparisons pairwise is not transitive and can lead to engine-dependent results.
 */
export function classifyThread(messages: ScanMessage[], ownEmails: Set<string>): ThreadBucket {
  if (messages.length === 0) return "no_reply";

  // Decide the ordering rule once for the whole thread. Mixing "compare by date"
  // and "compare by position" pairwise is not transitive — with A(dated),
  // B(undated), C(dated) you can get A<B, B<C, yet A>C, and JS leaves the result
  // of a non-transitive comparator implementation-defined. A thread's last message
  // decides awaiting_you vs stalled, so that must never be engine-dependent.
  const anyUndated = messages.some((m) => !m.date);
  const ordered = messages
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (anyUndated) return a.i - b.i;
      if (a.m.date < b.m.date) return -1;
      if (a.m.date > b.m.date) return 1;
      return a.i - b.i;
    })
    .map((x) => x.m);
  const theirs = ordered.filter((m) => !isOwn(m.from, ownEmails));
  if (theirs.length === 0) return "no_reply";

  const last = ordered[ordered.length - 1];
  return isOwn(last.from, ownEmails) ? "stalled" : "awaiting_you";
}

export interface ScannedThread {
  threadId: string;
  subject: string;
  bucket: ThreadBucket;
  /** ISO date of the founder's most recent message in the thread. */
  lastSent: string;
  recipients: MailAddress[];
  /** How this thread was judged. */
  judgement: ThreadJudgement;
  /** Compare mode only: did the two judges agree on inclusion? null otherwise. */
  agrees: boolean | null;
}

export interface FollowUp {
  email: string;
  name: string;
  company: string;
  lastSent: string;
  daysSince: number;
  subject: string;
  threadId: string;
  bucket: ThreadBucket;
  judgement: ThreadJudgement;
  agrees: boolean | null;
}

/** Whole days between two ISO dates, floored at 0. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** awaiting_you is the costlier miss, so it sorts first. */
const BUCKET_RANK: Record<ThreadBucket, number> = { awaiting_you: 0, no_reply: 1, stalled: 2 };

/** Highest urgency first; an unranked (heuristic) row sorts below every ranked one. */
const URGENCY_RANK: Record<string, number> = { hot: 0, warm: 1, low: 2, dead: 3 };
const urgencyRank = (f: FollowUp) =>
  f.judgement.urgency ? URGENCY_RANK[f.judgement.urgency] : 4;

/**
 * One row per recipient, carrying their most recent thread. `todayIso` is passed
 * in rather than read from the clock so this stays pure and testable.
 */
export function groupByRecipient(
  threads: ScannedThread[],
  ownEmails: Set<string>,
  todayIso: string,
): FollowUp[] {
  const latest = new Map<string, FollowUp>();

  for (const t of threads) {
    for (const r of t.recipients) {
      const email = r.email.trim().toLowerCase();
      if (!email.includes("@") || isOwn(email, ownEmails)) continue;

      const existing = latest.get(email);
      if (existing && existing.lastSent >= t.lastSent) continue;

      latest.set(email, {
        email,
        name: r.name || email,
        company: companyFromEmail(email),
        lastSent: t.lastSent,
        daysSince: daysBetween(t.lastSent, todayIso),
        subject: t.subject,
        threadId: t.threadId,
        bucket: t.bucket,
        judgement: t.judgement,
        agrees: t.agrees,
      });
    }
  }

  return [...latest.values()].sort(
    (a, b) =>
      urgencyRank(a) - urgencyRank(b) ||
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      b.daysSince - a.daysSince,
  );
}
