/* ============================================================
   Browser-side gateway to the Gmail API routes. Type-only imports
   from server modules are erased at build, so this stays client-safe.
   ============================================================ */

import type { ThreadSummary, ThreadDetail } from "./gmailApi";
import type { GmailAccountInfo } from "./accounts";

export type { ThreadSummary, ThreadDetail };
export type GmailAccount = GmailAccountInfo;

export interface GmailStatus {
  configured: boolean;
  redirectUri: string;
  accounts: GmailAccount[];
}

export async function getGmailStatus(): Promise<GmailStatus> {
  try {
    const res = await fetch("/api/gmail/status");
    if (!res.ok) return { configured: false, redirectUri: "", accounts: [] };
    return (await res.json()) as GmailStatus;
  } catch {
    return { configured: false, redirectUri: "", accounts: [] };
  }
}

export async function disconnectGmailAccount(id: string): Promise<void> {
  await fetch(`/api/gmail/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchThreads(
  accountId: string,
  q?: string,
): Promise<{ threads: ThreadSummary[]; needsReconnect: string[] }> {
  const params = new URLSearchParams({ accountId });
  if (q) params.set("q", q);
  const res = await fetch(`/api/gmail/threads?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `threads_${res.status}`);
  }
  return (await res.json()) as { threads: ThreadSummary[]; needsReconnect: string[] };
}

export async function fetchThread(accountId: string, id: string): Promise<ThreadDetail> {
  const params = new URLSearchParams({ accountId, id });
  const res = await fetch(`/api/gmail/thread?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `thread_${res.status}`);
  }
  return ((await res.json()) as { thread: ThreadDetail }).thread;
}

const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);

/** The participant who isn't one of the connected inboxes — i.e. the lead. */
export function counterpartyEmail(participants: string[], ownEmails: string[]): string {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  return participants.find((p) => !own.has(p.toLowerCase())) ?? participants[0] ?? "";
}

/** Best-effort company name from an email domain (client-safe mirror of parse.ts). */
export function guessCompany(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || FREE_PROVIDERS.has(domain)) return "";
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  const sld = labels.length >= 3 && labels[labels.length - 2].length <= 3
    ? labels[labels.length - 3]
    : labels[labels.length - 2];
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

/** Open the OAuth consent flow in a popup; resolves when it reports back. */
export function connectGmailPopup(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const popup = window.open("/api/gmail/connect", "gmail-connect", "width=520,height=640");
    let settled = false;

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "gmail-connected") return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve({ ok: !!e.data.ok, detail: e.data.detail ?? "" });
    };
    window.addEventListener("message", onMessage);

    // Fallback: if the popup closes without messaging, resolve as unknown.
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        if (!settled) {
          window.removeEventListener("message", onMessage);
          resolve({ ok: false, detail: "closed" });
        }
      }
    }, 600);
  });
}
