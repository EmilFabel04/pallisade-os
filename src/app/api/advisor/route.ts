import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError } from "@/lib/api/errors";
import { getAgent, AgentNotFound } from "@/lib/agents/registry";
import { runAgent, DEFAULT_MODEL } from "@/lib/agents/runtime";
import { renderBody } from "@/lib/agents/render";
import { resolveAvailability, resolveDriveAccountId, resolveFathomEnabled } from "@/lib/brain/availability";
import { connectedEmails } from "@/lib/gmail/advisorEmail";
import type { AdvisorSnapshot } from "@/lib/types";
import type { AgentContext, AgentSpec } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SERVICES =
  "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

// The pre-runtime route capped the Advisor at 2048 output tokens.
// runAgent defaults to 4096 (Brain's budget) — passing this explicitly keeps
// this surface's per-call cost and output ceiling unchanged.
const MAX_TOKENS = 2048;

/* Conditional appendices to the Sales Advisor persona. Both are copied
 * verbatim from the pre-runtime route (advisor/route.ts:92-118, before this
 * migration) and were deliberately left out of src/agents/sales-advisor.md —
 * an agent-file body is one unconditional blob, and baking these in would
 * have the Advisor announce "Google Calendar is connected." or reach for
 * query_emails on a surface where neither integration is actually connected.
 * They are spliced onto the rendered body below, only when the corresponding
 * integration is live. */
const EMAIL_APPENDIX =
  `Use query_emails (Gmail search syntax) or list_inboxes to read real email when the founder ` +
  `asks about their inbox, a sender, or recent messages — never invent email content.\n\n` +
  `To find people who have gone quiet, use audit_sent_followups — it reads real SENT mail, ` +
  `excludes Apollo mailwarming, and buckets each recipient as 'awaiting_you' (they replied and are ` +
  `waiting on the founder — lead with these) or 'no_reply' (never came back). Report the names and ` +
  `days since contact it returns; the company is derived from the email domain, so treat it as a ` +
  `hint rather than a verified name. Then propose a create_task follow-up for each person worth ` +
  `chasing, so the founder can confirm them. Cross-reference query_leads to say whether each person ` +
  `is already in the pipeline. If followUps is empty but excludedSignoffOnly is large, say that ` +
  `too: it means the strict "signed off as Emil" rule filtered almost everything out, which is a ` +
  `tuning problem, not an empty pipeline. And say plainly, in your own words, whenever any of these ` +
  `are set — coverage may be incomplete and the founder should know why: cappedReasons "cap" or ` +
  `"per_inbox" means the thread ceiling (cite the cap value) was reached and older mail wasn't read; ` +
  `"listing_failure" means an inbox couldn't be read at all — a failure, not a coverage limit; ` +
  `"empty_page_bail" means paging stopped early on a narrow query and there may be more behind it; ` +
  `listingFailures > 0 means that many inboxes couldn't be read; fetchFailures > 0 means that many ` +
  `threads were skipped; labelLookupFailed means the mailwarming safety net was inactive for an ` +
  `inbox, so a warming thread could have slipped through.`;

const CALENDAR_APPENDIX =
  `Google Calendar is connected. Use query_calendar to read upcoming meetings, and ` +
  `create_calendar_event to propose booking a call or follow-up (confirm-gated, like other writes). ` +
  `Resolve relative times against today's date and pass a full ISO date-time for start.`;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: DEFAULT_MODEL });
}

interface AdvisorRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: AdvisorSnapshot;
  agentId?: string;
  context?: { businessName?: string; founderName?: string; services?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError("agent_unconfigured", 503);

  let body: AdvisorRequest;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", 400);
  }

  // The CRM read tools dereference ctx.snapshot directly and throw without
  // one (capabilities.ts) — reject before any upstream call rather than
  // letting that surface as an opaque 502.
  const { snapshot } = body;
  if (!snapshot) return apiError("missing_snapshot", 400);

  const agentId = body.agentId ?? "sales-advisor";

  let spec: AgentSpec;
  try {
    spec = await getAgent(agentId);
  } catch (err) {
    // AgentNotFound means the id genuinely doesn't exist. Anything else — a
    // readdir failure, a malformed .md throwing from buildSpec, a
    // loadOverrides DB error — is a real server failure and must not be
    // silently relabeled "not found" with an empty console.
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  // sales-advisor does not declare `drive` today, so this resolves to null
  // without a DB read. It is wired anyway so that granting `drive` in the
  // agent file is all it takes — rather than silently reproducing the Brain's
  // defect, where the tools arrived and every call answered "not connected".
  const [{ emailEnabled, calendarEnabled }, driveAccountId] = await Promise.all([
    resolveAvailability(spec),
    resolveDriveAccountId(spec),
  ]);

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || DEFAULT_SERVICES,
    snapshot,
    proposals: [],
    projectSnapshot: null,
    emailEnabled,
    calendarEnabled,
    driveAccountId,
    fathomEnabled: resolveFathomEnabled(spec),
  };

  let rendered = renderBody(spec.body, ctx);
  if (emailEnabled) {
    rendered += `\n\nConnected Gmail inboxes: ${(await connectedEmails()).join(", ")}. ${EMAIL_APPENDIX}`;
  }
  if (calendarEnabled) rendered += `\n\n${CALENDAR_APPENDIX}`;

  try {
    const result = await runAgent({
      spec: { ...spec, body: rendered },
      messages: (body.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
      ctx,
      client: new Anthropic({ apiKey }),
      maxTokens: MAX_TOKENS,
    });

    // Preserves the pre-runtime route's fallback: a turn that ends with a
    // queued write but no trailing summary text should still tell the
    // founder something was queued, not "I couldn't produce a response".
    const content =
      result.content ||
      (result.proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.");

    return NextResponse.json({ content, actions: result.proposals, stoppedBy: result.stoppedBy });
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }
}
