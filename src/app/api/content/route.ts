import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ContentType, ProposedAction } from "@/lib/types";
import { TOOLS, resolveTool } from "@/lib/advisor/tools";
import { buildContentSystemPrompt, CONTENT_TOOL_NAMES } from "@/lib/content/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 6;

// Read-only subset of the Advisor's tools — selected by name from the shared registry.
const CONTENT_TOOLS = TOOLS.filter((t) =>
  (CONTENT_TOOL_NAMES as readonly string[]).includes(t.name),
);

// Anthropic executes web_search server-side and resolves it inside response.content,
// so only these local tools need a synthetic tool_result.
const LOCAL_TOOL_NAMES = new Set<string>(CONTENT_TOOL_NAMES);

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface ContentRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: AdvisorSnapshot;
  profile?: { name?: string; body?: string };
  contentType?: ContentType;
  context?: { businessName?: string; founderName?: string; services?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: ContentRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const snapshot = body.snapshot;
  if (!snapshot) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });
  if (!body.profile?.body) {
    return NextResponse.json({ error: "missing_profile" }, { status: 400 });
  }

  const contentType: ContentType = body.contentType ?? "social";
  const today = new Date().toISOString().slice(0, 10);

  const system = buildContentSystemPrompt({
    profile: { name: body.profile.name || "Untitled", body: body.profile.body },
    contentType,
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services:
      body.context?.services ||
      "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools",
    today,
  });

  const client = new Anthropic({ apiKey });
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    ...CONTENT_TOOLS,
  ] as unknown as Anthropic.Tool[];
  // resolveTool needs a proposals array for write tools; ours are all read tools,
  // so it stays empty and is never returned to the client.
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = (body.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 3072,
        system,
        tools,
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      // web_search splits prose into contiguous citation-boundary blocks that already
      // contain proper spacing; join with "" not "\n" to avoid spurious newlines.
      if (textParts.length) finalText = textParts.join("").trim();

      const toolUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" && LOCAL_TOOL_NAMES.has(blk.name),
      );

      // web_search may pause its server-side loop; resume by re-requesting with the
      // partial assistant turn appended and no synthetic tool_result.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: resolveTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals),
      }));
      messages.push({ role: "user", content: results });
    }

    if (!finalText) finalText = "I couldn't produce a response — try rephrasing.";
    return NextResponse.json({ content: finalText });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
