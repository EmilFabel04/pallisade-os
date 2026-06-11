import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";
import { TOOLS, resolveTool } from "@/lib/advisor/tools";

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

  const system =
    `You are the Sales Advisor for ${biz}, a solo B2B agency run by ${founder} that sells ${services} ` +
    `to boutique asset managers and B2B service businesses. You help run the pipeline: leads, interactions, ` +
    `projects, tasks, daily scorecards and a pain-point bank.\n\n` +
    `Use the read tools (query_*, search_pain_points, get_pipeline_metrics) to ground every answer in the ` +
    `founder's real data — never invent leads, numbers or history. Use the skill tools to generate call ` +
    `summaries, business reviews and tomorrow plans when helpful.\n\n` +
    `When the founder wants to change data, call the matching write tool (create_task, create_lead, ` +
    `update_lead, log_interaction, create_project). Write tools do NOT execute immediately — they are ` +
    `queued as proposals the founder must confirm in the UI. After proposing, briefly tell them what you've ` +
    `queued and that it's awaiting their confirmation; do not claim it is already done. For update_lead, ` +
    `always pass an id you obtained from query_leads. Be concise, direct and practical.`;

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
        system,
        tools: TOOLS as unknown as Anthropic.Tool[],
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

      // record the assistant turn, then answer every tool_use with a tool_result
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: resolveTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals),
      }));
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
