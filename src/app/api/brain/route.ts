import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError } from "@/lib/api/errors";
import { getAgent } from "@/lib/agents/registry";
import { runAgent, DEFAULT_MODEL } from "@/lib/agents/runtime";
import { renderBody } from "@/lib/agents/render";
import { formatAttachmentsBlock } from "@/lib/brain/attachments";
import type { AgentContext, AgentSpec } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SERVICES =
  "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

/** Founder override, same env var the pre-runtime route read. The runtime
 *  itself has no env path (spec.model ?? DEFAULT_MODEL) — the route is
 *  responsible for splicing BRAIN_MODEL onto the resolved spec. */
function resolvedModel(): string {
  return process.env.BRAIN_MODEL?.trim() || DEFAULT_MODEL;
}

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: resolvedModel() });
}

interface BrainRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  mode?: "strategist" | "brainstorm";
  agentId?: string;
  attachments?: { name: string; content: string }[];
  context?: {
    businessName?: string;
    founderName?: string;
    services?: string;
    driveAccountId?: string;
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError("agent_unconfigured", 503);

  let body: BrainRequest;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", 400);
  }

  // `mode` is still accepted so existing clients keep working: strategist and
  // brainstorm are now two agents rather than two branches. `agentId` (Task
  // 14's picker) wins when both are present.
  const agentId = body.agentId ?? (body.mode === "brainstorm" ? "product-brainstorm" : "strategist");

  let spec: AgentSpec;
  try {
    spec = await getAgent(agentId);
  } catch {
    return apiError("agent_not_found", 404);
  }

  const envModel = process.env.BRAIN_MODEL?.trim();
  if (envModel) spec = { ...spec, model: envModel };

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || DEFAULT_SERVICES,
    // Brain carries no snapshot surface — the write/read tool resolvers that
    // dereference ctx.snapshot are never granted to a Brain agent.
    snapshot: null,
    proposals: [],
    // Neither Brain persona declares the "email"/"calendar" capability
    // groups today, and the availability checks are DB-backed (they touch
    // the founder's production database). Wiring them in only when a Brain
    // agent actually asks for them avoids a new, unnecessary DB dependency
    // on every Brain turn.
    emailEnabled: false,
    calendarEnabled: false,
    driveAccountId: body.context?.driveAccountId ?? null,
  };

  let rendered = renderBody(spec.body, ctx);
  const attachments = formatAttachmentsBlock(body.attachments ?? []);
  if (attachments) rendered += `\n\n${attachments}`;

  try {
    const result = await runAgent({
      spec: { ...spec, body: rendered },
      messages: (body.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
      ctx,
      client: new Anthropic({ apiKey }),
    });
    return NextResponse.json({
      content: result.content || "I couldn't produce a response — try rephrasing.",
      stoppedBy: result.stoppedBy,
    });
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }
}
