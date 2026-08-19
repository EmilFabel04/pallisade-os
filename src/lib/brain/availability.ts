import { emailToolsAvailable } from "@/lib/gmail/advisorEmail";
import { calendarToolsAvailable } from "@/lib/calendar/advisorCalendar";
import { isConfigured, hasDriveScope } from "@/lib/gmail/config";
import { listAccounts } from "@/lib/gmail/accounts";
import { isConfigured as fathomConfigured } from "@/lib/fathom/config";
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

/** The id of the connected account that granted Drive read scope, or null.
 *  This is the same two-line resolution api/drive/status performs; it lives
 *  here so both the status route and the agent routes derive it from one
 *  place. */
export async function connectedDriveAccountId(): Promise<string | null> {
  if (!isConfigured()) return null;
  const acct = (await listAccounts()).find((a) => hasDriveScope(a.tokens.scope));
  return acct?.id ?? null;
}

/** The Drive account id an agent's ctx should carry, resolved SERVER-SIDE.
 *
 *  It used to arrive from the browser, and only the brainstorm branch of the
 *  Brain page sent one — so the strategist, which declares `drive` and is told
 *  to reach for drive_search, received the tools with ctx.driveAccountId null
 *  and got {"error":"Google Drive is not connected…"} from every call, which it
 *  then relayed to the founder as a fact about their own integrations. A
 *  failure rendered as an answer.
 *
 *  Gated on the spec declaring `drive`, exactly like resolveAvailability above:
 *  an agent that never asks for Drive costs zero DB contact. */
export async function resolveDriveAccountId(
  spec: Pick<AgentSpec, "tools">,
): Promise<string | null> {
  if (!spec.tools.includes("drive")) return null;
  return connectedDriveAccountId();
}

/** Whether an agent's ctx should carry Fathom access.
 *
 *  Synchronous, unlike the email/calendar/Drive resolvers above: this is an env
 *  read, not a DB read, so there is no cost to gate against and nothing to join
 *  in a Promise.all. Still spec-gated for the same reason they are — an agent
 *  that never asks for Fathom should not carry a flag implying it did. */
export function resolveFathomEnabled(spec: Pick<AgentSpec, "tools">): boolean {
  return spec.tools.includes("fathom") && fathomConfigured();
}
