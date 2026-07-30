import type { Lead, Target, Task } from "@/lib/types";
import { addDaysISO } from "@/lib/utils";
import { targetToLead, type NewLead } from "./promote";

export type NewTask = Omit<Task, "id" | "createdAt" | "updatedAt">;

/** How far out a "call back" is scheduled. */
export const CALLBACK_DAYS = 7;

/** The due date for a callback booked on `fromISO` (a YYYY-MM-DD day). */
export function callbackDueDate(fromISO: string): string {
  return addDaysISO(fromISO, CALLBACK_DAYS);
}

/**
 * The Lead a callback promotes its target into. Status is "contacted" rather
 * than the usual "new" — asking to be called back means we already spoke.
 * `nextFollowUp` is set here because the task→lead sync lives in TaskForm, so
 * a task created straight through the store wouldn't otherwise reach the lead.
 */
export function callbackLead(
  target: Target,
  founderName: string,
  dueDate: string,
): NewLead {
  return {
    ...targetToLead(target, founderName),
    status: "contacted" satisfies Lead["status"],
    nextFollowUp: dueDate,
  };
}

/** The follow-up task reminding us to ring them back, linked to the new lead. */
export function callbackTask(
  target: Target,
  leadId: string,
  dueDate: string,
): NewTask {
  const who = [target.company, target.contactName].filter(Boolean).join(" — ");
  return {
    title: `Call back ${who}`,
    linkKind: "lead",
    linkId: leadId,
    category: "follow-up",
    priority: "medium",
    status: "not started",
    dueDate,
    notes: "",
    milestoneId: null,
  };
}
