"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneOutgoing, RotateCw } from "lucide-react";
import {
  useStore,
  useTargets,
  useDialLists,
  useScorecards,
  useSettings,
} from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/Modal";
import { findToday, buildEntries, refreshEntries } from "@/lib/dial/snapshot";
import { targetToLead } from "@/lib/targets/promote";
import { useScheduleCallback } from "@/lib/targets/useScheduleCallback";
import { todayScorecard } from "@/lib/selectors";
import { todayISO, nowISO } from "@/lib/utils";
import type { DialEntry, Target } from "@/lib/types";

const DAILY_COUNT = 20;

const CALL_LABEL = ["—", "once", "twice", "thrice"];
function callLabel(n: number): string {
  return CALL_LABEL[n] ?? `${n}×`;
}

const OUTCOME_LABEL: Record<NonNullable<DialEntry["outcome"]>, string> = {
  interested: "→ Lead",
  not_interested: "Not interested",
  callback: "→ Call back",
};

/** A row is done once it has an outcome, or if its target left the list elsewhere. */
function outcomeLabel(e: DialEntry): string {
  return e.outcome ? OUTCOME_LABEL[e.outcome] : "Removed";
}

export default function DialPage() {
  const store = useStore();
  const targets = useTargets();
  const dialLists = useDialLists();
  const scorecards = useScorecards();
  const settings = useSettings();
  const scheduleCallback = useScheduleCallback();

  const today = todayISO();
  const todayList = findToday(dialLists, today);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  // Generate today's frozen snapshot once, on first view of a day that has at
  // least one eligible target. A synchronous date-keyed ref guards against
  // React Strict Mode's double mount-effect invocation (store.create only
  // queues a setData, so the findToday recheck alone is racy). `targets` is in
  // the deps so importing prospects mid-day triggers generation instead of
  // leaving an empty day frozen.
  const generatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!store.ready) return;
    if (findToday(store.dialLists, today)) {
      generatedFor.current = today;
      return;
    }
    if (generatedFor.current === today) return;
    const entries = buildEntries(targets, DAILY_COUNT);
    if (entries.length === 0) return; // no eligible targets yet — don't freeze an empty day
    generatedFor.current = today;
    store.create("dialLists", { date: today, entries });
    // store.* and targets are the real deps; listed explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, today, targets]);

  const targetById = useMemo(() => {
    const m = new Map<string, Target>();
    for (const t of targets) m.set(t.id, t);
    return m;
  }, [targets]);

  /** Replace one entry's fields within today's snapshot. */
  const patchEntry = (targetId: string, patch: Partial<DialEntry>) => {
    if (!todayList) return;
    const entries = todayList.entries.map((e) =>
      e.targetId === targetId ? { ...e, ...patch } : e,
    );
    store.update("dialLists", todayList.id, { entries });
  };

  /** Log a call: bump the target's count + stamp, and add 1 to today's Scorecard dials. */
  const logCall = (t: Target) => {
    store.update("targets", t.id, {
      callCount: (t.callCount ?? 0) + 1,
      lastCalledAt: nowISO(),
    });
    const sc = todayScorecard(scorecards);
    if (sc) {
      store.update("scorecards", sc.id, { dials: sc.dials + 1 });
    } else {
      store.create("scorecards", {
        date: todayISO(),
        dials: 1,
        emails: 0,
        linkedinMessages: 0,
        replies: 0,
        conversations: 0,
        leadsCreated: 0,
        meetingsBooked: 0,
        proposalsSent: 0,
        productHours: 0,
        seoWork: "",
        revenueClosed: 0,
        wins: "",
        problems: "",
        lessons: "",
        avoidTomorrow: "",
      });
    }
  };

  /** Interested: promote to a Lead, remove the target, mark the row done. */
  const markInterested = (t: Target) => {
    store.create("leads", targetToLead(t, settings.founderName));
    store.remove("targets", t.id);
    patchEntry(t.id, { outcome: "interested" });
  };

  /** Not interested: flag the target out of all future rotations, mark the row done. */
  const markNotInterested = (t: Target) => {
    store.update("targets", t.id, { disposition: "not_interested" });
    patchEntry(t.id, { outcome: "not_interested" });
  };

  /**
   * Call back: you can't be asked to ring back without having dialled, so this
   * counts the dial too, then promotes to a lead carrying a follow-up task.
   */
  const markCallback = (t: Target) => {
    logCall(t);
    scheduleCallback(t);
    patchEntry(t.id, { outcome: "callback" });
  };

  /** Redraw the untouched rows, keeping today's actioned ones. */
  const refresh = () => {
    if (!todayList) return;
    store.update("dialLists", todayList.id, {
      entries: refreshEntries(todayList.entries, targets, DAILY_COUNT),
    });
  };

  const doneCount = todayList?.entries.filter((e) => e.outcome != null).length ?? 0;
  const openCount = (todayList?.entries.length ?? 0) - doneCount;
  const refreshMessage =
    `Draws ${openCount === 1 ? "a new prospect" : `${openCount} new prospects`} in place of the ` +
    `${openCount === 1 ? "one" : openCount} you haven't actioned yet. ` +
    (doneCount > 0
      ? `Your ${doneCount} completed ${doneCount === 1 ? "row stays" : "rows stay"} put. `
      : "") +
    "Nobody already on today's list is drawn again.";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dial List"
        subtitle="Today's 20 prospects to call, drawn at random from your Targets. Refreshes tomorrow."
        actions={
          todayList && todayList.entries.length > 0 ? (
            <button className="btn" onClick={() => setConfirmRefresh(true)}>
              <RotateCw size={15} /> Refresh list
            </button>
          ) : null
        }
      />
      {!todayList || todayList.entries.length === 0 ? (
        <EmptyState
          icon={PhoneOutgoing}
          title="No one to dial yet"
          message="Import prospects on the Targets page and a list of 20 will appear here each day."
        />
      ) : (
        <Panel title={`Today · ${todayList.entries.length}`} noPad>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Context</th>
                  <th className="text-right">Calls</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {todayList.entries.map((e) => {
                  const t = targetById.get(e.targetId);
                  const done = e.outcome != null;
                  if (!t || done) {
                    // Completed row — render from the denormalized label.
                    return (
                      <tr key={e.targetId} className="opacity-50">
                        <td className="font-medium" colSpan={5}>{e.label}</td>
                        <td className="text-right whitespace-nowrap">
                          {outcomeLabel(e)}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={e.targetId}>
                      <td className="font-medium text-[var(--color-ink)]">{t.company}</td>
                      <td>
                        <div className="text-[var(--color-ink-soft)]">{t.contactName || "—"}</div>
                        <div className="text-[0.74rem] text-[var(--color-dim)]">{t.contactRole}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        {t.phone ? (
                          <a className="link" href={`tel:${t.phone}`}>{t.phone}</a>
                        ) : (
                          <span className="text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                      <td className="text-[var(--color-dim)]">
                        <div className="truncate max-w-[180px]">
                          {[t.industry, t.location].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="text-right tnum">{callLabel(t.callCount ?? 0)}</td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button className="btn btn-sm" onClick={() => logCall(t)}>Log call</button>
                          <button className="btn btn-sm" onClick={() => markInterested(t)}>Interested</button>
                          <button className="btn btn-sm" title="Promote and book a follow-up call in a week" onClick={() => markCallback(t)}>Call back</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => markNotInterested(t)}>Not interested</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <ConfirmDialog
        open={confirmRefresh}
        onClose={() => setConfirmRefresh(false)}
        onConfirm={refresh}
        title="Refresh today's list?"
        message={refreshMessage}
        confirmLabel="Refresh"
      />
    </div>
  );
}
