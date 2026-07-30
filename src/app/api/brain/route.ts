import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import Anthropic from "@anthropic-ai/sdk";
import { buildBrainSystemPrompt, formatAttachmentsBlock } from "@/lib/brain/prompt";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "@/lib/brain/tools";
import {
  PROJECT_CONTEXT_TOOLS, PROJECT_CONTEXT_TOOL_NAMES, resolveProjectContextTool,
} from "@/lib/projects/projectContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.BRAIN_MODEL || "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface BrainRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  mode?: "strategist" | "brainstorm";
  attachments?: { name: string; content: string }[];
  context?: { businessName?: string; founderName?: string; driveAccountId?: string };
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

  const mode = body.mode === "brainstorm" ? "brainstorm" : "strategist";
  const today = new Date().toISOString().slice(0, 10);
  const businessName = body.context?.businessName || "Pallisade Data";
  const founderName = body.context?.founderName || "the founder";

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ---- strategist: tool loop (project context only) ----
  if (mode === "strategist") {
    const system = buildBrainSystemPrompt({ businessName, founderName, today });
    try {
      let finalText = "";
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system,
          tools: PROJECT_CONTEXT_TOOLS as unknown as Anthropic.Tool[],
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

        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: await Promise.all(
            toolUses.map(async (tu) => ({
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: await resolveProjectContextTool(tu.name, (tu.input ?? {}) as Record<string, unknown>),
            })),
          ),
        });
      }
      return NextResponse.json({ content: finalText || "I couldn't produce a response — try rephrasing." });
    } catch (err) {
      return apiError(UPSTREAM_FAILED, 502, err);
    }
  }

  // ---- brainstorm: tool loop (web_search + Drive) ----
  const attachmentsBlock = formatAttachmentsBlock(body.attachments ?? []);
  let system = buildBrainSystemPrompt({ businessName, founderName, today, mode: "brainstorm" });
  if (attachmentsBlock) system += `\n\n${attachmentsBlock}`;

  const driveAccountId = body.context?.driveAccountId ?? null;
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ...DRIVE_TOOLS,
    ...PROJECT_CONTEXT_TOOLS,
  ] as unknown as Anthropic.Tool[];

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools,
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      if (textParts.length) finalText = textParts.join("\n").trim();

      // Only our local tools (Drive + project context) need a tool_result; web_search is
      // executed server-side by Anthropic and already resolved in `response.content`.
      const localUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" &&
          (DRIVE_TOOL_NAMES.has(blk.name) || PROJECT_CONTEXT_TOOL_NAMES.has(blk.name)),
      );

      // web_search may pause its server-side loop; resume by re-requesting with the
      // partial assistant turn appended and no synthetic tool_result.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason !== "tool_use" || localUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        localUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: PROJECT_CONTEXT_TOOL_NAMES.has(tu.name)
            ? await resolveProjectContextTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
            : await resolveBrainTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, driveAccountId),
        })),
      );
      messages.push({ role: "user", content: results });
    }

    return NextResponse.json({ content: finalText || "I couldn't produce a response — try rephrasing." });
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
