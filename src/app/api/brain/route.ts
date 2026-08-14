import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError } from "@/lib/api/errors";
import { getAgent, AgentNotFound } from "@/lib/agents/registry";
import { runAgent, DEFAULT_MODEL } from "@/lib/agents/runtime";
import { renderBody } from "@/lib/agents/render";
import { formatAttachmentsBlock } from "@/lib/brain/attachments";
import { resolveAvailability } from "@/lib/brain/availability";
import type { AgentContext, AgentSpec } from "@/lib/agents/types";
import type { AdvisorSnapshot } from "@/lib/types";

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

/**
 * The CRM read tools (query_leads, get_pipeline_metrics, …) resolve against a
 * snapshot. The Advisor gets one from the client with every turn; the Brain
 * client sends none, so it is loaded here from the same DB the client store
 * persists to — the pattern resolveProjectContextTool already uses for
 * list_projects. Without it, an agent declaring `crm` receives the tools and
 * then gets {"error":"no snapshot available for this tool"} from every call.
 *
 * Loaded ONLY for a spec that declares `crm`, mirroring resolveAvailability:
 * an agent that never asks for the CRM costs zero DB reads.
 */
async function crmSnapshot(spec: AgentSpec): Promise<AdvisorSnapshot | null> {
  if (!spec.tools.includes("crm")) return null;
  const { loadAll } = await import("@/lib/db/sqlite");
  return await loadAll();
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

  // Restores the pre-migration guard: reject empty input before any upstream
  // call rather than letting it reach the SDK and surface as a 502.
  if (!body.messages || body.messages.length === 0) {
    return apiError("missing_messages", 400);
  }

  // `mode` is still accepted so existing clients keep working: strategist and
  // brainstorm are now two agents rather than two branches. `agentId` (Task
  // 14's picker) wins when both are present.
  const agentId = body.agentId ?? (body.mode === "brainstorm" ? "product-brainstorm" : "strategist");

  let spec: AgentSpec;
  try {
    spec = await getAgent(agentId);
  } catch (err) {
    // AgentNotFound means the id genuinely doesn't exist. Anything else —
    // a readdir failure, a malformed .md throwing from buildSpec, a
    // loadOverrides DB error — is a real server failure and must not be
    // silently relabeled "not found" with an empty console. apiError only
    // logs when passed a cause, so the distinction matters for anyone
    // debugging a 500-shaped problem that now reads 404.
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  const envModel = process.env.BRAIN_MODEL?.trim();
  if (envModel) spec = { ...spec, model: envModel };

  const { emailEnabled, calendarEnabled } = await resolveAvailability(spec);

  let snapshot: AdvisorSnapshot | null;
  try {
    snapshot = await crmSnapshot(spec);
  } catch (err) {
    // A whole-DB read failing is a server failure, not a tool failure: every
    // CRM answer this turn would be wrong. Fail loudly with the cause logged
    // rather than letting the agent narrate around an empty pipeline.
    return apiError("agent_failed", 502, err);
  }

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || DEFAULT_SERVICES,
    // Read-side only. `proposals` stays empty because no Brain agent declares
    // `writes`, so nothing here can queue a mutation.
    snapshot,
    proposals: [],
    emailEnabled,
    calendarEnabled,
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
