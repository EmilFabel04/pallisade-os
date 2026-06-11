import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// The Anthropic SDK needs the Node runtime; never cache AI responses.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const EFFORT = "high" as const;

/* ---------------- JSON schemas (structured output) ---------------- */

const strArray = { type: "array", items: { type: "string" } } as const;

const CALL_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cleanSummary: { type: "string" },
    keyPainPoints: strArray,
    objections: strArray,
    buyingSignals: strArray,
    suggestedFollowUpMessage: { type: "string" },
    suggestedNextStep: { type: "string" },
    offerAngle: { type: "string" },
  },
  required: [
    "cleanSummary",
    "keyPainPoints",
    "objections",
    "buyingSignals",
    "suggestedFollowUpMessage",
    "suggestedNextStep",
    "offerAngle",
  ],
} as const;

const BUSINESS_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    whatHappened: strArray,
    movedForward: strArray,
    wastedTime: strArray,
    bestOpportunities: strArray,
    risks: strArray,
    followUps: strArray,
    topPriorities: strArray,
    outreachFocus: { type: "string" },
    buildFocus: { type: "string" },
  },
  required: [
    "whatHappened",
    "movedForward",
    "wastedTime",
    "bestOpportunities",
    "risks",
    "followUps",
    "topPriorities",
    "outreachFocus",
    "buildFocus",
  ],
} as const;

/* ---------------- status ---------------- */

export async function GET() {
  return NextResponse.json({
    configured: !!process.env.ANTHROPIC_API_KEY,
    model: MODEL,
    effort: EFFORT,
  });
}

/* ---------------- generate ---------------- */

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured — tell the client so it falls back to the local mock.
    return NextResponse.json({ error: "no_key" }, { status: 503 });
  }

  let body: { kind?: string; input?: Record<string, unknown>; context?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const biz = body.context?.businessName || "Pallisade Data";
  const services =
    body.context?.services ||
    "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

  try {
    if (body.kind === "callSummary") {
      const system =
        `You are the sales strategist for ${biz}, a solo B2B agency selling ${services} ` +
        `to boutique asset managers and B2B service businesses. Turn rough interaction notes into a crisp, ` +
        `actionable structured summary. Be concrete and specific; never invent facts not present in the notes. ` +
        `Lists should contain short, distinct points. The suggested follow-up message should be ready to send ` +
        `(warm, professional, specific to what was discussed).`;
      const prompt = renderCallPrompt(body.input ?? {});
      const result = await runStructured(client, system, prompt, CALL_SUMMARY_SCHEMA);
      return NextResponse.json({ result: { ...result, generatedAt: new Date().toISOString() } });
    }

    if (body.kind === "businessReview") {
      const system =
        `You are the chief-of-staff for ${biz}, a solo founder selling ${services} to boutique asset managers ` +
        `and B2B service businesses. Read a messy end-of-day brain dump and return a sharp, structured review. ` +
        `Be honest and direct about wasted time and risks. topPriorities must be exactly 3 concrete, actionable ` +
        `items for tomorrow. Never invent facts not implied by the update.`;
      const text = String((body.input as { text?: string })?.text ?? "");
      const result = await runStructured(client, system, text, BUSINESS_REVIEW_SCHEMA);
      // enforce exactly 3 priorities
      if (Array.isArray(result.topPriorities)) result.topPriorities = result.topPriorities.slice(0, 3);
      return NextResponse.json({ result: { ...result, generatedAt: new Date().toISOString() } });
    }

    return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  } catch (err) {
    // Surface the failure so the client can fall back to the mock.
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/* ---------------- helpers ---------------- */

async function runStructured(
  client: Anthropic,
  system: string,
  userText: string,
  schema: object,
): Promise<Record<string, unknown>> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: userText }],
    // Sonnet 4.6 at high effort + schema-constrained JSON output.
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema },
    },
  } as Anthropic.MessageCreateParamsNonStreaming);

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

function renderCallPrompt(input: Record<string, unknown>): string {
  const f = (k: string) => (input[k] ? String(input[k]) : "");
  return [
    `Company: ${f("company") || "—"}`,
    `Contact: ${f("contact") || "—"}`,
    "",
    "RAW NOTES:",
    f("rawNotes") || "(none)",
    "",
    f("whatTheySaid") ? `What they said: ${f("whatTheySaid")}` : "",
    f("painPoints") ? `Pain points jotted: ${f("painPoints")}` : "",
    f("objections") ? `Objections jotted: ${f("objections")}` : "",
    f("buyingSignals") ? `Buying signals jotted: ${f("buyingSignals")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
