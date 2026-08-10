import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { capexQuery, type CapexQueryParams } from "@/lib/pricing/capexQuery";
import { normalizeCapex } from "@/lib/pricing/normalize";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";
/** Search pauses its server-side loop; this bounds how many times we resume. */
const MAX_TURNS = 6;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

const saveTool = {
  name: "save_capex",
  description: "Save the researched spending capacity for this company.",
  input_schema: {
    type: "object" as const,
    properties: {
      band: {
        type: "string",
        enum: ["unknown", "micro", "small", "mid", "enterprise"],
        description:
          "micro: under ~10 staff or clearly pre-revenue. small: ~10-50. mid: ~50-500 or an established firm with real budget. enterprise: 500+ or a large institution. unknown when the evidence does not support a call.",
      },
      headcount: { type: "number", description: "Approximate staff count, if found." },
      revenueNote: {
        type: "string",
        description: "Revenue, AUM or funding in one short phrase, if found.",
      },
      evidence: {
        type: "array",
        description: "Every claim with the URL it came from. No URL, no claim.",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            url: { type: "string" },
          },
          required: ["claim", "url"],
        },
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["band", "evidence", "confidence"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: CapexQueryParams;
  try {
    body = (await req.json()) as CapexQueryParams;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const query = capexQuery(body);
  if (!query) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const system =
    "You research how much a company can afford to spend on software. Search the web, then save " +
    "a capacity band with the sources behind it. Report only what you can cite — an unsourced guess " +
    "about a client's balance sheet is worse than admitting you found nothing, because it will move " +
    "a real price. If the company is too small or too private to read, save band \"unknown\" with " +
    "confidence \"low\" and whatever partial evidence you did find.";

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Research this company's spending capacity, then call save_capex.\n\n${query}` },
  ];

  try {
    const client = new Anthropic({ apiKey });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        output_config: { effort: "medium" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          saveTool,
        ] as unknown as Anthropic.Tool[],
        messages,
      });

      const saved = response.content.find(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" && blk.name === "save_capex",
      );
      if (saved) {
        return NextResponse.json(
          normalizeCapex(saved.input as Record<string, unknown>, nowISO()),
        );
      }

      messages.push({ role: "assistant", content: response.content });

      // The server-side search loop hit its iteration cap. Re-request as-is —
      // the API resumes from the trailing server_tool_use block, and an extra
      // user turn here derails it.
      if (response.stop_reason === "pause_turn") continue;

      // It stopped without saving. Ask once, plainly, then let the loop bound it.
      messages.push({
        role: "user",
        content:
          "Call save_capex now with your best assessment. If the research was inconclusive, " +
          'use band "unknown" with confidence "low".',
      });
    }

    return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
