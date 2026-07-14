"use client";

import { useCallback } from "react";
import { useStore, useSettings } from "@/lib/store";
import { todayISO } from "@/lib/utils";
import { callbackDueDate, callbackLead, callbackTask } from "./callback";
import type { Target } from "@/lib/types";

/**
 * Promote a target into a lead and book the follow-up call for a week out.
 * Shared by the dial list and the targets list; the dial list additionally
 * counts the dial and marks its snapshot row, which is its own concern.
 *
 * Returns the callback's due date so callers can report it.
 */
export function useScheduleCallback(): (target: Target) => string {
  const store = useStore();
  const settings = useSettings();

  return useCallback(
    (target: Target) => {
      const dueDate = callbackDueDate(todayISO());
      const lead = store.create(
        "leads",
        callbackLead(target, settings.founderName, dueDate),
      );
      store.create("tasks", callbackTask(target, lead.id, dueDate));
      store.remove("targets", target.id);
      return dueDate;
    },
    [store, settings.founderName],
  );
}
