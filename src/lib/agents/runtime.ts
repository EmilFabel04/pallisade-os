/* The agent loop, once. Replaces the copies in the advisor, brain and
   project-chat routes. */

import type Anthropic from "@anthropic-ai/sdk";
import type { ProposedAction } from "@/lib/types";
import { dispatch, toolsFor, SERVER_TOOL_NAMES } from "./capabilities";
import type { AgentContext, AgentSpec } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const MAX_ITERATIONS = 8;
const DEFAULT_MAX_TOKENS = 4096;

/** Minimal surface of the Anthropic client, so tests can stub it. */
export interface MessageCreator {
  messages: {
    create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface RunAgentResult {
  content: string;
  proposals: ProposedAction[];
  stoppedBy: "end" | "max_iterations";
}

export async function runAgent(input: {
  spec: AgentSpec;
  messages: Anthropic.MessageParam[];
  ctx: AgentContext;
  client: MessageCreator;
  maxTokens?: number;
}): Promise<RunAgentResult> {
  const { spec, ctx, client } = input;
  const tools = toolsFor(spec.tools, ctx);
  const messages = [...input.messages];

  let finalText = "";
  let stoppedBy: RunAgentResult["stoppedBy"] = "max_iterations";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: spec.model ?? DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: spec.body,
      tools: tools as unknown as Anthropic.Tool[],
      messages,
    });

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    // A server-executed tool (web_search) pauses the turn. Resume by appending
    // the partial assistant turn with no synthetic tool_result.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const localUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && !SERVER_TOOL_NAMES.has(b.name),
    );

    if (response.stop_reason !== "tool_use" || localUses.length === 0) {
      stoppedBy = "end";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      localUses.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: await dispatch(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx),
      })),
    );
    messages.push({ role: "user", content: results });
  }

  return { content: finalText, proposals: ctx.proposals, stoppedBy };
}
