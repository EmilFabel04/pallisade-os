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

/** Newest-first thread ceiling for one audit. */
export const SCAN_CAP = 400;

/** Gmail allows ~250 quota units/sec and threads.get costs 10, so ~25/sec is the
 *  ceiling. 8 in flight stays well under it. */
export const FETCH_CONCURRENCY = 8;

export interface SentAuditResult {
  scanned: number;
  matched: number;
  cap: number;
  capped: boolean;
  fetchFailures: number;
  /** Threads that failed both the subject and sign-off rules. A looser sign-off
   *  rule would start admitting these — the number to watch if results look thin. */
  excludedSignoffOnly: number;
  excludedWarming: number;
  /** Threads where they replied but the founder answered last: counted, not listed. */
  stalledNotShown: number;
  followUps: FollowUp[];
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

/** Gmail label id → display name, for one account. */
async function labelNames(accountId: string): Promise<Map<string, string>> {
  const res = await gmailGet<{ labels?: { id: string; name: string }[] }>(accountId, "labels")
    .catch(skipUnlessAuth({ labels: [] as { id: string; name: string }[] }));
  return new Map((res.labels ?? []).map((l) => [l.id, l.name]));
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
  opts: { query?: string; limit?: number } = {},
): Promise<SentAuditResult> {
  const accounts = await listAccountInfo();
  const ownEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const cap = Math.min(Math.max(1, opts.limit ?? SCAN_CAP), SCAN_CAP);

  // Exclude warming server-side so those threads are never fetched.
  const q = [`in:sent`, `-label:"${WARMING_LABEL}"`, opts.query?.trim()]
    .filter(Boolean)
    .join(" ");

  const perAccount = Math.max(1, Math.ceil(cap / Math.max(1, accounts.length)));

  let scanned = 0;
  let fetchFailures = 0;
  let excludedSignoffOnly = 0;
  let excludedWarming = 0;
  let stalledNotShown = 0;
  const kept: ScannedThread[] = [];

  for (const account of accounts) {
    const [ids, labels] = await Promise.all([
      listThreadIds(account.id, { q, max: perAccount }).catch(skipUnlessAuth([] as string[])),
      labelNames(account.id),
    ]);

    const threads = await mapPool(ids, FETCH_CONCURRENCY, (id) =>
      gmailGet<RawThread>(account.id, `threads/${id}`, { format: "full" })
        .catch(skipUnlessAuth<RawThread | null>(null)),
    );

    for (const raw of threads) {
      if (!raw?.messages?.length) {
        fetchFailures++;
        continue;
      }
      scanned++;

      const messages = toScanMessages(raw.messages);
      const ourMessages = messages.filter((m) => ownEmails.has(m.from.trim().toLowerCase()));
      const names = [
        ...new Set(raw.messages.flatMap((m) => (m.labelIds ?? []).map((id) => labels.get(id) ?? id))),
      ];
      const subject = header(raw.messages[0].payload?.headers, "Subject");

      const verdict = judgeThread({
        subject,
        labelNames: names,
        ownMessageBodies: ourMessages.map((m) => m.text),
      });
      if (!verdict.included) {
        if (verdict.reason === "warming_label") excludedWarming++;
        else excludedSignoffOnly++;
        continue;
      }

      const bucket = classifyThread(messages, ownEmails);
      if (bucket === "stalled") {
        stalledNotShown++;
        continue;
      }

      const lastOurs = ourMessages.map((m) => m.date).sort().pop() ?? "";
      kept.push({
        threadId: raw.id,
        subject: subject || "(no subject)",
        bucket,
        lastSent: lastOurs,
        recipients: ourMessages.flatMap((m) => m.to),
      });
    }
  }

  const followUps = groupByRecipient(kept, ownEmails, new Date().toISOString());

  return {
    scanned,
    matched: kept.length,
    cap,
    capped: scanned >= cap,
    fetchFailures,
    excludedSignoffOnly,
    excludedWarming,
    stalledNotShown,
    followUps,
  };
}
