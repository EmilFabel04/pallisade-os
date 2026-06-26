import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildBrainSystemPrompt } from "@/lib/brain/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.BRAIN_MODEL || "claude-sonnet-4-6";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface BrainRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  context?: { businessName?: string; founderName?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: BrainRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body.messages || body.messages.length === 0) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = buildBrainSystemPrompt({
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    today,
  });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages,
    });

    const finalText = response.content
      .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
      .map((blk) => blk.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      content: finalText || "I couldn't produce a response — try rephrasing.",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
