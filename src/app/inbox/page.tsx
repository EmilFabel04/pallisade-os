"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Plus, Loader2, RefreshCw, Trash2, Search, AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ThreadList } from "@/components/inbox/ThreadList";
import { ThreadReader } from "@/components/inbox/ThreadReader";
import { buildLead, buildInteraction } from "@/lib/advisor/applyAction";
import { cn, nowISO } from "@/lib/utils";
import type { Lead } from "@/lib/types";
import {
  getGmailStatus, fetchThreads, fetchThread, disconnectGmailAccount,
  connectGmailPopup, counterpartyEmail, guessCompany,
  type GmailStatus, type ThreadSummary, type ThreadDetail,
} from "@/lib/gmail/gmailClient";

export default function InboxPage() {
  const store = useStore();
  const router = useRouter();
  const { leads } = store;

  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [account, setAccount] = useState<string>("all");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState<string[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ThreadSummary | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [logged, setLogged] = useState<Set<string>>(new Set());

  const ownEmails = useMemo(() => status?.accounts.map((a) => a.email) ?? [], [status]);
  const accountEmailById = useMemo(
    () => new Map((status?.accounts ?? []).map((a) => [a.id, a.email])),
    [status],
  );
  const leadByEmail = useMemo(() => {
    const m = new Map<string, Lead>();
    for (const l of leads) if (l.email) m.set(l.email.toLowerCase(), l);
    return m;
  }, [leads]);

  const refreshStatus = useCallback(async () => {
    const s = await getGmailStatus();
    setStatus(s);
    return s;
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const loadThreads = useCallback(async () => {
    if (!status?.configured || status.accounts.length === 0) return;
    setLoadingThreads(true);
    setThreadsError(null);
    try {
      const { threads: t, needsReconnect: nr } = await fetchThreads(account, search || undefined);
      setThreads(t);
      setNeedsReconnect(nr);
    } catch (e) {
      setThreadsError((e as Error).message);
    } finally {
      setLoadingThreads(false);
    }
  }, [status, account, search]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const openThread = async (t: ThreadSummary) => {
    setSelected(t);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await fetchThread(t.accountId, t.id));
    } catch (e) {
      setThreadsError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    const r = await connectGmailPopup();
    setConnecting(false);
    if (r.ok) {
      const s = await refreshStatus();
      if (s.accounts.length) void loadThreads();
    }
  };

  const disconnect = async (id: string) => {
    await disconnectGmailAccount(id);
    if (account === id) setAccount("all");
    setSelected(null);
    setDetail(null);
    await refreshStatus();
  };

  const matchedLead = useMemo<Lead | null>(() => {
    if (!detail) return null;
    for (const e of detail.participants) {
      const l = leadByEmail.get(e);
      if (l) return l;
    }
    return null;
  }, [detail, leadByEmail]);

  const createLeadFromThread = () => {
    if (!detail) return;
    const email = counterpartyEmail(detail.participants, ownEmails);
    const fromAddr =
      detail.messages.find((m) => m.from.email.toLowerCase() === email.toLowerCase())?.from ??
      detail.messages[detail.messages.length - 1]?.from;
    const lead = store.create("leads", buildLead({
      company: guessCompany(email),
      contactName: fromAddr && fromAddr.name !== fromAddr.email ? fromAddr.name : "",
      email,
      source: "email",
      status: "new",
      notes: `Created from inbox thread: "${detail.subject}"`,
    })) as Lead;
    router.push(`/leads?focus=${lead.id}`);
  };

  const logToLead = () => {
    if (!detail || !matchedLead) return;
    const last = detail.messages[detail.messages.length - 1];
    store.create("interactions", buildInteraction({
      leadId: matchedLead.id,
      company: matchedLead.company,
      contact: matchedLead.contactName || last?.from.name || "",
      type: "email reply",
      date: (last?.date || nowISO()).slice(0, 10),
      rawNotes: `Subject: ${detail.subject}\n\n${(last?.text || last?.snippet || "").slice(0, 4000)}`,
      whatTheySaid: last?.snippet ?? "",
      followUpRequired: false,
    }));
    setLogged((prev) => new Set(prev).add(detail.id));
  };

  /* ---------- render ---------- */

  const configured = status?.configured;
  const accounts = status?.accounts ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inbox"
        subtitle="Your Gmail, inside the OS — read threads, spin up leads from senders, and log emails to the right lead."
        actions={
          configured && accounts.length > 0 ? (
            <button className="btn btn-ghost" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add inbox
            </button>
          ) : undefined
        }
      />

      {status === null && (
        <Panel><div className="flex items-center gap-2 p-2 text-[0.84rem] text-[var(--color-dim)]">
          <Loader2 size={14} className="animate-spin" /> Checking Gmail connection…
        </div></Panel>
      )}

      {status && !configured && <SetupNotice redirectUri={status.redirectUri} />}

      {configured && accounts.length === 0 && (
        <Panel>
          <EmptyState
            icon={Inbox}
            title="Connect a Gmail inbox"
            message="Sign in with Google to read your threads here, create leads from senders and log emails to your pipeline."
            action={
              <button className="btn btn-accent" onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Connect Gmail
              </button>
            }
          />
        </Panel>
      )}

      {configured && accounts.length > 0 && (
        <>
          {/* account tabs + search */}
          <Panel>
            <div className="flex flex-wrap items-center gap-2 p-1">
              <AccountTab label="All inboxes" active={account === "all"} onClick={() => setAccount("all")} />
              {accounts.map((a) => (
                <AccountTab
                  key={a.id}
                  label={a.email}
                  active={account === a.id}
                  warn={needsReconnect.includes(a.id)}
                  onClick={() => setAccount(a.id)}
                  onRemove={() => void disconnect(a.id)}
                />
              ))}
              <div className="flex-1" />
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-dim)]" />
                  <input
                    className="input pl-7 pr-2 py-1 text-[0.8rem]"
                    style={{ width: 200 }}
                    placeholder="Search mail…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") setSearch(query.trim()); }}
                  />
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => void loadThreads()} disabled={loadingThreads}>
                  <RefreshCw size={13} className={loadingThreads ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          </Panel>

          {needsReconnect.length > 0 && (
            <Panel>
              <div className="flex items-center gap-2 p-1 text-[0.8rem] text-[var(--color-accent)]">
                <AlertTriangle size={14} />
                {needsReconnect.length} inbox needs reconnecting — click “Add inbox” and sign in again.
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
            <Panel noPad className="overflow-hidden">
              <div className="overflow-y-auto" style={{ maxHeight: "66vh" }}>
                {loadingThreads ? (
                  <div className="flex items-center gap-2 p-4 text-[0.8rem] text-[var(--color-dim)]">
                    <Loader2 size={14} className="animate-spin" /> Loading mail…
                  </div>
                ) : threadsError ? (
                  <p className="p-4 text-[0.8rem] text-[var(--color-accent)]">{threadsError}</p>
                ) : threads.length === 0 ? (
                  <p className="p-4 text-[0.8rem] text-[var(--color-dim)]">No threads found.</p>
                ) : (
                  <ThreadList
                    threads={threads}
                    selectedId={selected?.id ?? null}
                    onSelect={openThread}
                    leadByEmail={leadByEmail}
                    accountEmailById={accountEmailById}
                    showAccount={account === "all"}
                  />
                )}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div style={{ height: "66vh" }} className="overflow-hidden">
                {loadingDetail ? (
                  <div className="flex items-center gap-2 p-4 text-[0.8rem] text-[var(--color-dim)]">
                    <Loader2 size={14} className="animate-spin" /> Opening thread…
                  </div>
                ) : detail ? (
                  <ThreadReader
                    thread={detail}
                    matchedLead={matchedLead}
                    logged={logged.has(detail.id)}
                    onCreateLead={createLeadFromThread}
                    onLogToLead={logToLead}
                    onViewLead={(l) => router.push(`/leads?focus=${l.id}`)}
                  />
                ) : (
                  <EmptyState icon={Inbox} title="No thread selected" message="Pick a conversation on the left to read it here." />
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function AccountTab({
  label, active, warn, onClick, onRemove,
}: {
  label: string;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.78rem] cursor-pointer transition-colors",
        active
          ? "border-[var(--color-line-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink)]"
          : "border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]",
      )}
      onClick={onClick}
    >
      {warn && <AlertTriangle size={11} className="text-[var(--color-accent)]" />}
      {label}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-0 group-hover:opacity-100 text-[var(--color-dim)] hover:text-[var(--color-accent)]"
          title="Disconnect"
        >
          <Trash2 size={11} />
        </button>
      )}
    </span>
  );
}

function SetupNotice({ redirectUri }: { redirectUri: string }) {
  return (
    <Panel title="Connect Gmail — one-time setup">
      <div className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed space-y-2 p-1">
        <p>To link your inboxes, create a free Google OAuth client and add its credentials to <code>.env.local</code>:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Go to <a className="link-accent" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> → create a project.</li>
          <li>APIs &amp; Services → <strong>Enable</strong> the <strong>Gmail API</strong>.</li>
          <li>OAuth consent screen → <strong>External</strong>, add your own email as a test user.</li>
          <li>Credentials → Create <strong>OAuth client ID</strong> → <strong>Web application</strong>.</li>
          <li>Add this <strong>Authorized redirect URI</strong>:<br />
            <code className="text-[var(--color-ink-soft)]">{redirectUri}</code>
          </li>
          <li>Copy the Client ID &amp; Secret into <code>.env.local</code>:
            <pre className="mt-1 rounded-md p-2 text-[0.78rem]" style={{ background: "var(--color-canvas)", border: "1px solid var(--color-line)" }}>
GOOGLE_CLIENT_ID=…apps.googleusercontent.com{"\n"}GOOGLE_CLIENT_SECRET=…</pre>
          </li>
          <li>Restart the app, then reload this page.</li>
        </ol>
      </div>
    </Panel>
  );
}
