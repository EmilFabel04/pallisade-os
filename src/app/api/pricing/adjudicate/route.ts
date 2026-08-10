import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { adjudicateBrief, type AdjudicateRequest } from "@/lib/pricing/adjudicateBrief";
import { normalizeAdjudication } from "@/lib/pricing/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_price",
  description: "Save the recommended target and stretch prices.",
  input_schema: {
    type: "object" as const,
    properties: {
      setup: {
        type: "object",
        description: "Omit entirely when the brief says there is no setup range.",
        properties: {
          target: { type: "number", description: "What to quote. Must sit inside the setup range." },
          stretch: { type: "number", description: "What to try if intent is strong. At or above target." },
        },
        required: ["target", "stretch"],
      },
      monthly: {
        type: "object",
        properties: {
          target: { type: "number", description: "Must sit inside the monthly range." },
          stretch: { type: "number", description: "At or above target." },
        },
        required: ["target", "stretch"],
      },
      reasoning: {
        type: "string",
        description:
          "Two or three sentences: what in the evidence justifies this placement. Name the specific signal or comparable, not the general shape of the deal.",
      },
    },
    required: ["monthly", "reasoning"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: AdjudicateRequest;
  try {
    body = (await req.json()) as AdjudicateRequest;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.bounds?.monthly) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const system =
    "You price a deal for a solo B2B software founder. You are given ranges that are already decided — " +
    "your job is placement inside them, never the ranges themselves. Numbers outside the given range are " +
    "discarded, so proposing one wastes the turn. Place the target where the evidence says the client " +
    "will actually say yes, and the stretch where they might if intent is strong. Strong, recent, " +
    "specific buying signals and a large capex band push both up; unanswered objections, a stale last " +
    "contact, or a thin evidence base pull them toward the floor. Absence of evidence is not evidence " +
    "of enthusiasm.";

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      output_config: { effort: "high" },
      tools: [saveTool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_price" },
      messages: [{ role: "user", content: adjudicateBrief(body) }],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    if (!toolUse) return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "generation_incomplete" }, { status: 502 });
    }

    return NextResponse.json(normalizeAdjudication(toolUse.input as Record<string, unknown>));
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
