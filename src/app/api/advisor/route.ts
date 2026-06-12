import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";
import { TOOLS, EMAIL_TOOLS, EMAIL_TOOL_NAMES, resolveTool } from "@/lib/advisor/tools";
import { emailToolsAvailable, connectedEmails, resolveEmailTool } from "@/lib/gmail/advisorEmail";

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
    `direct and practical.`;

  // Offer Gmail read tools only when an inbox is connected.
  const emailEnabled = emailToolsAvailable();
  const tools = emailEnabled ? [...TOOLS, ...EMAIL_TOOLS] : TOOLS;
  const systemFull = emailEnabled
    ? `${system}\n\nConnected Gmail inboxes: ${connectedEmails().join(", ")}. Use query_emails ` +
      `(Gmail search syntax) or list_inboxes to read real email when the founder asks about their inbox, ` +
      `a sender, or recent messages — never invent email content.`
    : system;

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
