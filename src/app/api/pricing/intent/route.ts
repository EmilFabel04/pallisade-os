import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { loadAll } from "@/lib/db/sqlite";
import { buildIntentContext } from "@/lib/pricing/intentContext";
import { normalizeIntent } from "@/lib/pricing/normalize";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_intent",
  description: "Save the buying-intent read for this lead.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: {
        type: "number",
        description: "Buying intent from 0 (no interest) to 100 (ready to sign).",
      },
      band: { type: "string", enum: ["cold", "warm", "hot"] },
      signals: {
        type: "array",
        description:
          "Evidence for the score. Every quote must be text that appears verbatim in the supplied records — never a paraphrase.",
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "Verbatim text from a record." },
            weight: { type: "number", description: "0-1: how much this moved the score." },
          },
          required: ["quote", "weight"],
        },
      },
      risks: {
        type: "array",
        description: "What could stall or kill this deal.",
        items: { type: "string" },
      },
    },
    required: ["score", "band", "signals", "risks"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let leadId = "";
  try {
    ({ leadId } = (await req.json()) as { leadId: string });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!leadId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const data = await loadAll();
    const ctx = buildIntentContext(data, leadId);
    if (!ctx) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

    const system =
      "You read a B2B sales CRM and judge how badly this client wants to buy. " +
      "Score only on evidence present in the records — a quiet record is a low score, not a guess. " +
      "Every signal you cite must quote the record verbatim so the founder can trace the score back to " +
      "something a person actually said. Weigh recent interactions above old ones, explicit budget or " +
      "deadline talk above general enthusiasm, and treat unanswered objections as risk.";

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      output_config: { effort: "low" },
      tools: [saveTool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_intent" },
      messages: [
        {
          role: "user",
          content: `Read this lead and its interaction history, then save the intent read.\n\n${JSON.stringify(ctx, null, 2)}`,
        },
      ],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    if (!toolUse) return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "generation_incomplete" }, { status: 502 });
    }

    return NextResponse.json(
      normalizeIntent(toolUse.input as Record<string, unknown>, nowISO()),
    );
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
