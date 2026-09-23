/* ============================================================
   Sent-mail follow-up audit (server-only).

   Pages the founder's sent threads, fetches each candidate once, and applies
   the pure filters in sentScan.ts. Excludes Apollo mailwarming twice over:
   in the Gmail query (so warming threads are never fetched) and again against
   resolved label names, as a safety net.
   ============================================================ */

import { listAccountInfo } from "./accounts";
import { gmailGet, GmailAuthError } from "./client";
import { listThreadIds, isoFromInternal } from "./gmailApi";
import {
  header, parseAddress, parseAddressList, extractText,
  type GmailPayload,
} from "./parse";
import {
  judgeThread, classifyThread, groupByRecipient, WARMING_LABEL,
  type FollowUp, type ScanMessage, type ScannedThread,
} from "./sentScan";
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

/** Newest-first thread ceiling for one audit. */
export const SCAN_CAP = 400;

/** Gmail allows ~250 quota units/sec and threads.get costs 10, so ~25/sec is the
 *  ceiling. 8 in flight stays well under it. */
export const FETCH_CONCURRENCY = 8;

export interface SentAuditResult {
  scanned: number;
  /** Threads that passed inclusion and were kept — a thread count, not a
   *  recipient count. `followUps` deduplicates by recipient, so the two will
   *  routinely differ. */
  matched: number;
  cap: number;
  /** True when the scan stopped early — either the global cap was reached, or
   *  any single inbox exhausted its share of it — so older mail went unread.
   *  Conservative on purpose: an inbox that happened to have exactly its
   *  allowance and nothing more will also read as capped. */
  capped: boolean;
  /** Why the scan stopped short, when it did. Empty when coverage is complete.
   *  "cap" — the global thread ceiling was reached.
   *  "per_inbox" — one inbox exhausted its share of the ceiling.
   *  "listing_failure" — an inbox's thread listing failed, so it was never read.
   *  "empty_page_bail" — paging stopped after a run of empty pages, so a narrow
   *  query may have more matches behind them. */
  cappedReasons: string[];
  fetchFailures: number;
  /** Inboxes whose thread *listing* failed outright (as opposed to a single
   *  thread fetch failing). That whole account went unread — a non-zero value
   *  here means coverage is incomplete beyond what `capped` alone conveys. */
  listingFailures: number;
  /** True when an inbox's label list could not be fetched, so the warming-label
   *  safety net was inactive for it and only the server-side query excluded
   *  Apollo mailwarming. */
  labelLookupFailed: boolean;
  /** Threads that failed both the subject and sign-off rules. A looser sign-off
   *  rule would start admitting these — the number to watch if results look thin. */
  excludedSignoffOnly: number;
  excludedWarming: number;
  /** Threads where no message could be attributed to the founder, so they were skipped
   *  rather than emitting a row that can never render. This is a residual guard against
   *  malformed From headers, not an alias diagnostic: the query is in:sent, so every
   *  listed thread has a SENT-labelled message whose From is harvested into the own set. */
  excludedNoOwnMessage: number;
  /** Threads where they replied but the founder answered last: counted, not listed. */
  stalledNotShown: number;
  followUps: FollowUp[];
  judgeStats: JudgeStats;
  /** True when any thread fell back to the heuristic after a Jev failure. */
  degraded: boolean;
}

interface RawMessage {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}

interface RawThread {
  id: string;
  messages?: RawMessage[];
}

/** A thread that survived fetching and has at least one message from the
 *  founder, captured for judging after the per-account scan finishes. */
interface Candidate {
  raw: RawThread;
  messages: ScanMessage[];
  ourMessages: ScanMessage[];
  subject: string;
  labelNames: string[];
  accountOwnEmails: Set<string>;
}

/**
 * Swallow a per-request failure, but never an auth failure. A revoked token must
 * surface as "reconnect this inbox" — silently returning an empty audit would
 * read as "nobody needs a follow-up", the worst possible wrong answer here.
 */
function skipUnlessAuth<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof GmailAuthError) throw err;
    return fallback;
  };
}

/** Run `fn` over `items` with at most `size` promises in flight. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Fetch one thread, retrying once on a rate-limit response. Gmail's per-user quota
 *  is ~250 units/sec and threads.get costs 10, so a long scan can trip it; without a
 *  retry a single trip cascades into losing most of the remaining scan. Auth failures
 *  still propagate — only rate limits are retried. */
async function fetchThread(accountId: string, id: string): Promise<RawThread | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gmailGet<RawThread>(accountId, `threads/${id}`, { format: "full" });
    } catch (err) {
      if (err instanceof GmailAuthError) throw err;
      const rateLimited = /gmail_api_(429|403)/.test(String((err as Error).message ?? ""));
      if (!rateLimited || attempt === 1) return null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}

/** Gmail label id → display name, for one account. `failed` is true when the
 *  lookup itself failed (auth failures still propagate via skipUnlessAuth) —
 *  callers use it to flag that the warming-label safety net was inactive. */
async function labelNames(accountId: string): Promise<{ names: Map<string, string>; failed: boolean }> {
  let failed = false;
  const res = await gmailGet<{ labels?: { id: string; name: string }[] }>(accountId, "labels")
    .catch((err: unknown) => {
      const fallback = skipUnlessAuth({ labels: [] as { id: string; name: string }[] })(err);
      failed = true;
      return fallback;
    });
  return { names: new Map((res.labels ?? []).map((l) => [l.id, l.name])), failed };
}

function toScanMessages(messages: RawMessage[]): ScanMessage[] {
  return messages.map((m) => {
    const h = m.payload?.headers;
    return {
      from: parseAddress(header(h, "From")).email,
      // Full addresses, not bare emails — display names reach the founder's report.
      to: parseAddressList(header(h, "To")),
      date: isoFromInternal(m.internalDate, header(h, "Date")),
      text: extractText(m.payload),
    };
  });
}

/**
 * Scan the founder's sent mail across all connected inboxes and surface who
 * never replied (or who replied but is now owed a follow-up).
 *
 * Pages thread ids with the Apollo mailwarming label excluded server-side,
 * fetches each thread once (bounded concurrency), applies the pure inclusion/
 * classification rules from sentScan.ts, then aggregates one row per recipient.
 *
 * `opts.query` is ANDed onto the base `in:sent -label:"Apollo Mailwarming"`
 * query. `opts.limit` caps the newest-first scan, clamped to [1, SCAN_CAP].
 */
export async function auditSentFollowUps(
  opts: {
    query?: string;
    limit?: number;
    judge?: JudgeMode;
    /** Injected for tests; production uses the real fan-out. */
    deps?: { runJudge?: typeof runJudge };
  } = {},
): Promise<SentAuditResult> {
  const accounts = await listAccountInfo();
  const ownEmails = new Set(accounts.map((a) => a.email.trim().toLowerCase()));
  const requested = Number.isFinite(opts.limit) ? Number(opts.limit) : SCAN_CAP;
  const cap = Math.min(Math.max(1, requested), SCAN_CAP);

  // Exclude warming server-side so those threads are never fetched.
  const q = [`in:sent`, `-label:"${WARMING_LABEL}"`, opts.query?.trim()]
    .filter(Boolean)
    .join(" ");

  const perAccount = Math.max(1, Math.ceil(cap / Math.max(1, accounts.length)));

  let scanned = 0;
  let capped = false;
  const cappedReasons = new Set<string>();
  let labelLookupFailed = false;
  let fetchFailures = 0;
  let listingFailures = 0;
  let excludedSignoffOnly = 0;
  let excludedWarming = 0;
  let excludedNoOwnMessage = 0;
  let stalledNotShown = 0;
  const kept: ScannedThread[] = [];
  const candidates: Candidate[] = [];

  for (const account of accounts) {
    const [listed, labelResult] = await Promise.all([
      listThreadIds(account.id, { q, max: perAccount }).catch((err) => {
        if (err instanceof GmailAuthError) throw err;
        // This inbox went unread. Without recording it, the result would claim
        // complete, uncapped, failure-free coverage of an account never touched.
        listingFailures++;
        capped = true;
        cappedReasons.add("listing_failure");
        return { ids: [] as string[], truncated: false };
      }),
      labelNames(account.id),
    ]);
    const { ids, truncated } = listed;
    if (truncated) {
      capped = true;
      cappedReasons.add("empty_page_bail");
    }
    if (labelResult.failed) labelLookupFailed = true;
    const labels = labelResult.names;

    // A full page-set for this account means its allowance ran out, so older
    // threads went unread even if the global total stayed under `cap`.
    if (ids.length >= perAccount) {
      capped = true;
      cappedReasons.add("per_inbox");
    }

    const threads = await mapPool(ids, FETCH_CONCURRENCY, (id) => fetchThread(account.id, id));

    for (const raw of threads) {
      if (!raw?.messages?.length) {
        fetchFailures++;
        continue;
      }
      scanned++;

      const messages = toScanMessages(raw.messages);

      // A message carrying the SENT label was sent by the founder, whatever address
      // it went out as. Matching on the connected account's address alone would miss
      // every message sent through a "send mail as" alias, classifying his own threads
      // as though he had never written in them. gmail.readonly cannot read the sendAs
      // settings, so the label is the reliable signal. Discovered addresses accumulate
      // into ownEmails so the final groupByRecipient also excludes them as recipients.
      for (const m of raw.messages) {
        if (!m.labelIds?.includes("SENT")) continue;
        const from = parseAddress(header(m.payload?.headers, "From")).email.trim().toLowerCase();
        if (from.includes("@")) ownEmails.add(from);
      }

      const ourMessages = messages.filter((m) => ownEmails.has(m.from.trim().toLowerCase()));
      if (ourMessages.length === 0) {
        excludedNoOwnMessage++;
        continue;
      }

      const names = [
        ...new Set(raw.messages.flatMap((m) => (m.labelIds ?? []).map((id) => labels.get(id) ?? id))),
      ];
      const subject = header(raw.messages[0].payload?.headers, "Subject");

      candidates.push({
        raw,
        messages,
        ourMessages,
        subject,
        labelNames: names,
        accountOwnEmails: new Set(ownEmails),
      });
    }
  }

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

  const followUps = groupByRecipient(kept, ownEmails, todayIso);

  if (scanned >= cap) cappedReasons.add("cap");

  return {
    scanned,
    matched: kept.length,
    cap,
    capped: capped || scanned >= cap,
    cappedReasons: [...cappedReasons].sort(),
    fetchFailures,
    listingFailures,
    labelLookupFailed,
    excludedSignoffOnly,
    excludedWarming,
    excludedNoOwnMessage,
    stalledNotShown,
    followUps,
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
  };
}
