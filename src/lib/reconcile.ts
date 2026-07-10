import type { DataShape } from "./types";

/**
 * One-time, idempotent data reconciliation applied at hydration so existing
 * records adapt to newer behaviours.
 *
 * Follow-up sync: a lead's `nextFollowUp` is now set whenever a follow-up task
 * is logged against it (see TaskForm). Leads created before that wiring can have
 * open follow-up tasks but an empty `nextFollowUp`. Here we backfill each such
 * lead from the EARLIEST open follow-up task's due date — the next follow-up.
 *
 * Only empty `nextFollowUp` values are filled; an already-set date (manual or
 * from a newer task) is never clobbered. Running this repeatedly is a no-op.
 */
export function reconcileFollowUps(data: DataShape): DataShape {
  // leadId -> earliest open follow-up task due date (YYYY-MM-DD)
  const earliestByLead = new Map<string, string>();
  for (const t of data.tasks) {
    if (t.linkKind !== "lead" || !t.linkId) continue;
    if (t.category !== "follow-up") continue;
    if (t.status === "done") continue;
    if (!t.dueDate) continue;
    const due = t.dueDate.slice(0, 10);
    const current = earliestByLead.get(t.linkId);
    if (!current || due < current) earliestByLead.set(t.linkId, due);
  }

  if (earliestByLead.size === 0) return data;

  let changed = false;
  const leads = data.leads.map((l) => {
    if (l.nextFollowUp) return l; // never overwrite an existing date
    const due = earliestByLead.get(l.id);
    if (!due) return l;
    changed = true;
    return { ...l, nextFollowUp: due };
  });

  return changed ? { ...data, leads } : data;
}
