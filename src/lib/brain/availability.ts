import { emailToolsAvailable } from "@/lib/gmail/advisorEmail";
import { calendarToolsAvailable } from "@/lib/calendar/advisorCalendar";
import type { AgentSpec } from "@/lib/agents/types";

/** Resolves email/calendar availability only for the capability groups the
 *  spec actually declares. Both checks are DB-backed (they read the
 *  founder's connected-accounts table), so an agent that never asks for
 *  "email" or "calendar" costs zero DB contact — since Task 15 that is only
 *  product-brainstorm. The strategist and deal-strategist declare both and
 *  pay for two reads a turn; discovery-coach pays for calendar only and
 *  pipeline-analyst for email only.
 *  capabilities.ts also reads calendarEnabled for the "writes" group
 *  (create_calendar_event rides with the other mutations), so "writes"
 *  counts as wanting calendar too. */
export async function resolveAvailability(
  spec: Pick<AgentSpec, "tools">,
): Promise<{ emailEnabled: boolean; calendarEnabled: boolean }> {
  const wantsEmail = spec.tools.includes("email");
  const wantsCalendar = spec.tools.includes("calendar") || spec.tools.includes("writes");
  const [emailEnabled, calendarEnabled] = await Promise.all([
    wantsEmail ? emailToolsAvailable() : Promise.resolve(false),
    wantsCalendar ? calendarToolsAvailable() : Promise.resolve(false),
  ]);
  return { emailEnabled, calendarEnabled };
}
