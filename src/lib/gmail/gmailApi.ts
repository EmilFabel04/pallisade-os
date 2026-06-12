/* ============================================================
   Higher-level Gmail reads, shaped for the UI and the advisor.
   Server-only — builds on the authed gmailGet() helper.
   ============================================================ */

import { gmailGet } from "./client";
import {
  header, parseAddress, parseAddressList, extractText,
  type MailAddress, type GmailPayload,
} from "./parse";

export interface ThreadSummary {
  id: string;
  accountId: string;
  from: MailAddress;
  subject: string;
  snippet: string;
  date: string; // ISO
  unread: boolean;
  /** all participant emails seen in the thread (lowercased) — for lead matching */
  participants: string[];
}

export interface MessageView {
  id: string;
  from: MailAddress;
  to: MailAddress[];
  date: string; // ISO
  subject: string;
  text: string;
  snippet: string;
}

export interface ThreadDetail {
  id: string;
  accountId: string;
  subject: string;
  messages: MessageView[];
  participants: string[];
}

interface RawMessage {
  id: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

interface RawThread {
  id: string;
  snippet?: string;
  messages?: RawMessage[];
}

function isoFromInternal(ms: string | undefined, fallbackHeader: string): string {
  if (ms) {
    const n = Number(ms);
    if (Number.isFinite(n)) return new Date(n).toISOString();
  }
  if (fallbackHeader) {
    const d = new Date(fallbackHeader);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return "";
}

function collectParticipants(messages: RawMessage[]): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    const h = m.payload?.headers;
    for (const field of ["From", "To", "Cc"]) {
      for (const a of parseAddressList(header(h, field))) {
        if (a.email.includes("@")) set.add(a.email.toLowerCase());
      }
    }
  }
  return [...set];
}

/** Recent threads in the inbox, newest first, with a one-line summary each. */
export async function listThreads(
  accountId: string,
  opts: { q?: string; maxResults?: number } = {},
): Promise<ThreadSummary[]> {
  const list = await gmailGet<{ threads?: { id: string }[] }>(accountId, "threads", {
    maxResults: opts.maxResults ?? 20,
    q: opts.q,
    labelIds: "INBOX",
  });
  const ids = (list.threads ?? []).map((t) => t.id);

  const summaries = await Promise.all(
    ids.map(async (id) => {
      // format=metadata returns every header (From/Subject/Date/To…) but no body.
      const thread = await gmailGet<RawThread>(accountId, `threads/${id}`, {
        format: "metadata",
      }).catch(() => null);
      if (!thread?.messages?.length) return null;
      return summarizeThread(accountId, thread);
    }),
  );

  return summaries
    .filter((s): s is ThreadSummary => s !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function summarizeThread(accountId: string, thread: RawThread): ThreadSummary {
  const messages = thread.messages ?? [];
  const last = messages[messages.length - 1];
  const h = last.payload?.headers;
  return {
    id: thread.id,
    accountId,
    from: parseAddress(header(h, "From")),
    subject: header(h, "Subject") || "(no subject)",
    snippet: last.snippet ?? thread.snippet ?? "",
    date: isoFromInternal(last.internalDate, header(h, "Date")),
    unread: messages.some((m) => m.labelIds?.includes("UNREAD")),
    participants: collectParticipants(messages),
  };
}

/** Full thread with readable message bodies. */
export async function getThread(accountId: string, id: string): Promise<ThreadDetail> {
  const thread = await gmailGet<RawThread>(accountId, `threads/${id}`, { format: "full" });
  const messages = (thread.messages ?? []).map((m): MessageView => {
    const h = m.payload?.headers;
    return {
      id: m.id,
      from: parseAddress(header(h, "From")),
      to: parseAddressList(header(h, "To")),
      date: isoFromInternal(m.internalDate, header(h, "Date")),
      subject: header(h, "Subject"),
      text: extractText(m.payload),
      snippet: m.snippet ?? "",
    };
  });
  const subject = messages[0]?.subject || "(no subject)";
  return { id, accountId, subject, messages, participants: collectParticipants(thread.messages ?? []) };
}

/** Resolve the account's own email address from an access token (used at connect). */
export async function profileEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`profile_${res.status}`);
  const data = (await res.json()) as { emailAddress?: string };
  return data.emailAddress ?? "";
}
