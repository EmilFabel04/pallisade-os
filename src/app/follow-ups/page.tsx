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
import { visibleFollowUps } from "@/lib/gmail/followUpFilter";
import { addDaysISO, todayISO } from "@/lib/utils";
import { buildInteraction } from "@/lib/advisor/applyAction";
import type { FollowUp } from "@/lib/gmail/sentScan";
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

  // Hide anyone the founder already marked handled, or actively snoozed —
  // the predicate (and its future/past/no-state boundaries) is pinned by
  // unit tests in lib/gmail/followUpFilter.test.ts.
  const rows = useMemo(
    () => visibleFollowUps(run?.result.followUps ?? [], store.followUpState, todayISO()),
    [run, store.followUpState],
  );
  const stats = run?.result.judgeStats;

  const dismiss = (email: string, status: "handled" | "snoozed") => {
    const existing = store.followUpState.find((s) => s.email === email);
    const patch = { status, until: status === "snoozed" ? addDaysISO(todayISO(), 7) : null };
    if (existing) store.update("followUpState", existing.id, patch);
    else store.create("followUpState", { email, ...patch });
  };

  const logInteraction = (f: FollowUp) => {
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

  const createTask = (f: FollowUp) => {
    store.create("tasks", {
      title: `Follow up with ${f.name} (${f.company})`,
      category: "sales",
      priority: f.judgement.urgency === "hot" ? "high" : "medium",
      status: "not started",
      dueDate: todayISO(),
      notes: f.subject,
      linkKind: "none",
      linkId: null,
      milestoneId: null,
    });
  };

  if (configured && !configured.gmail) {
    return (
      <div className="space-y-5">
        <PageHeader title="Follow-ups" subtitle="Who is owed a reply, judged per thread." />
        <Panel>
          <EmptyState
            icon={MailWarning}
            title="No inbox connected"
            message="Connect a Gmail account on the Inbox page and the audit can read your sent mail."
            action={
              <button className="btn btn-accent" onClick={() => router.push("/inbox")}>
                Go to Inbox
              </button>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Follow-ups" subtitle="Who is owed a reply, judged per thread." />

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="select text-[0.8rem]"
            style={{ width: 130 }}
          >
            {SCAN_SIZES.map((n) => (
              <option key={n} value={n}>{n} threads</option>
            ))}
          </select>

          <button onClick={runAudit} disabled={running} className="btn btn-accent">
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {running ? "Scanning…" : "Run audit"}
          </button>

          <button
            onClick={() => setCompare((c) => !c)}
            className="btn btn-sm"
            style={
              compare
                ? { borderColor: "var(--color-accent)", color: "var(--color-ink)" }
                : { color: "var(--color-muted)" }
            }
          >
            <ArrowLeftRight size={13} />
            Compare
          </button>

          {configured && !configured.jev && (
            <span className="text-[0.76rem] text-[var(--color-muted)]">
              Ranking is off — running the keyword heuristic. Add TYPESAFE_API_KEY to rank by urgency.
            </span>
          )}
        </div>
      </Panel>

      {error && <p className="text-[0.8rem] text-[var(--color-accent)]">{error}</p>}

      {stats && (
        <div className="flex flex-wrap items-center gap-3 text-[0.78rem] text-[var(--color-muted)]">
          <span>scanned <span className="tnum">{run?.result.scanned}</span></span>
          <span><span className="tnum">{rows.length}</span> owed a reply</span>
          <span className="tnum">{(stats.costUSD * 100).toFixed(2)}¢</span>
          <span className="tnum">{(stats.ms / 1000).toFixed(1)}s</span>
          {run?.result.degraded && (
            <span className="flex items-center gap-1 text-[var(--color-warning)]">
              <AlertTriangle size={13} />
              {stats.failures} judged by the keyword rule
            </span>
          )}
          {run?.result.capped && (
            <span className="flex items-center gap-1 text-[var(--color-warning)]">
              <AlertTriangle size={13} />
              partial scan ({run.result.cappedReasons.join(", ")})
            </span>
          )}
        </div>
      )}

      {compare && stats && <ComparePanel stats={stats} />}

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
    </div>
  );
}
