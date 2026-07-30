import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";
import {
  TOOLS, EMAIL_TOOLS, EMAIL_TOOL_NAMES, CALENDAR_TOOLS, CALENDAR_READ_TOOL_NAMES, resolveTool,
} from "@/lib/advisor/tools";
import { emailToolsAvailable, connectedEmails, resolveEmailTool } from "@/lib/gmail/advisorEmail";
import { calendarToolsAvailable, resolveCalendarTool } from "@/lib/calendar/advisorCalendar";
import {
  PROJECT_CONTEXT_TOOLS, PROJECT_CONTEXT_TOOL_NAMES, resolveProjectContextTool,
} from "@/lib/projects/projectContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface AdvisorRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: AdvisorSnapshot;
  context?: { businessName?: string; founderName?: string; services?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: AdvisorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const snapshot = body.snapshot;
  if (!snapshot) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });

  const biz = body.context?.businessName || "Pallisade Data";
  const founder = body.context?.founderName || "the founder";
  const services = body.context?.services ||
    "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, for date-relative tasks

  const system =
    `Today's date is ${today}. When the founder says "tomorrow", "next week" etc., resolve dates relative ` +
    `to that and pass concrete ISO dates (YYYY-MM-DD) to tools.\n\n` +
    `You are the Sales Advisor for ${biz}, a solo B2B agency run by ${founder} that sells ${services} ` +
    `to boutique asset managers and B2B service businesses. You help run the pipeline: leads, interactions, ` +
    `projects, tasks, daily scorecards and a pain-point bank.\n\n` +
    `Personality: you're a sharp, seasoned sales strategist who is genuinely in ${founder}'s corner — ` +
    `confident, professional, and energised about closing. Bring warmth and a bit of hunger: celebrate real ` +
    `wins, hype the strong opportunities, and call out risks and cold leads straight, without sugar-coating. ` +
    `You're smart and decisive — you give a clear recommendation, not a menu of options. Talk like a trusted ` +
    `partner, not a corporate bot: natural, punchy, occasionally a well-placed bit of dry wit. But personality ` +
    `never overrides substance — stay grounded in the real data, never invent numbers or history, never let ` +
    `enthusiasm turn into fluff or length. Confident and concise beats verbose every time.\n\n` +
    `Use the read tools (query_*, search_pain_points, get_pipeline_metrics) to ground every answer in the ` +
    `founder's real data — never invent leads, numbers or history. Use the skill tools to generate call ` +
    `summaries, business reviews and tomorrow plans when helpful.\n\n` +
    `When the founder wants to change data, call the matching write tool (create_task, create_lead, ` +
    `update_lead, update_task, log_interaction, create_project). You can fully edit a lead with update_lead ` +
    `(any field — contact details, firmographics, pipeline status, value, notes) and edit/reschedule/complete ` +
    `tasks with update_task. Write tools do NOT execute immediately — they are queued as proposals the founder ` +
    `must confirm in the UI. After proposing, briefly tell them what you've queued and that it's awaiting their ` +
    `confirmation; do not claim it is already done. For update_lead / update_task, always pass an id you ` +
    `obtained from query_leads / query_tasks, and only include the fields you intend to change. Be concise, ` +
    `direct and practical.\n\n` +
    `For delivery work, use list_projects and get_project_context. get_project_context returns a project's ` +
    `milestones, open tasks, linked repo with recent commits, and what was decided in its most recent project ` +
    `chat — reach for it whenever the founder asks how a build is going or what was agreed on a project.`;

  // Offer Gmail / calendar tools only when those are connected.
  const [emailEnabled, calendarEnabled] = await Promise.all([
    emailToolsAvailable(),
    calendarToolsAvailable(),
  ]);
  const tools = [
    ...TOOLS,
    ...PROJECT_CONTEXT_TOOLS,
    ...(emailEnabled ? EMAIL_TOOLS : []),
    ...(calendarEnabled ? CALENDAR_TOOLS : []),
  ];
  let systemFull = system;
  if (emailEnabled) {
    systemFull +=
      `\n\nConnected Gmail inboxes: ${(await connectedEmails()).join(", ")}. Use query_emails ` +
      `(Gmail search syntax) or list_inboxes to read real email when the founder asks about their inbox, ` +
      `a sender, or recent messages — never invent email content.`;
    systemFull +=
      `\n\nTo find people who have gone quiet, use audit_sent_followups — it reads real SENT mail, ` +
      `excludes Apollo mailwarming, and buckets each recipient as 'awaiting_you' (they replied and are ` +
      `waiting on the founder — lead with these) or 'no_reply' (never came back). Report the names and ` +
      `days since contact it returns; the company is derived from the email domain, so treat it as a ` +
      `hint rather than a verified name. Then propose a create_task follow-up for each person worth ` +
      `chasing, so the founder can confirm them. Cross-reference query_leads to say whether each person ` +
      `is already in the pipeline. If the result has capped: true, say so plainly and cite the result's ` +
      `own cap value — the scan stopped at that many threads and older mail was not read. If followUps ` +
      `is empty but excludedSignoffOnly is large, say that too: it means the strict "signed off as ` +
      `Emil" rule filtered almost everything out, which is a tuning problem, not an empty pipeline.`;
  }
  if (calendarEnabled) {
    systemFull +=
      `\n\nGoogle Calendar is connected. Use query_calendar to read upcoming meetings, and ` +
      `create_calendar_event to propose booking a call or follow-up (confirm-gated, like other writes). ` +
      `Resolve relative times against today's date and pass a full ISO date-time for start.`;
  }

  const client = new Anthropic({ apiKey });
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = (body.messages ?? []).map((m) => ({
    role: m.role, content: m.content,
  }));

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemFull,
        tools: tools as unknown as Anthropic.Tool[],
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      if (textParts.length) finalText = textParts.join("\n").trim();

      const toolUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      // record the assistant turn, then answer every tool_use with a tool_result.
      // Email tools resolve async (Gmail API); everything else is synchronous.
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const content = EMAIL_TOOL_NAMES.has(tu.name)
            ? await resolveEmailTool(tu.name, input)
            : CALENDAR_READ_TOOL_NAMES.has(tu.name)
            ? await resolveCalendarTool(tu.name, input)
            : PROJECT_CONTEXT_TOOL_NAMES.has(tu.name)
            ? await resolveProjectContextTool(tu.name, input)
            : resolveTool(tu.name, input, snapshot, proposals);
          return { type: "tool_result" as const, tool_use_id: tu.id, content };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      finalText = proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.";
    }

    return NextResponse.json({ content: finalText, actions: proposals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
