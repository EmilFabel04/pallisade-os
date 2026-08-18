import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError } from "@/lib/api/errors";
import { getAgent, AgentNotFound } from "@/lib/agents/registry";
import { runAgent, DEFAULT_MODEL } from "@/lib/agents/runtime";
import { renderBody } from "@/lib/agents/render";
import { resolveAvailability, resolveDriveAccountId } from "@/lib/brain/availability";
import { buildProjectStateBlock } from "@/lib/projects/prompt";
import { linkedRepoPathFor } from "@/lib/git/linkedRepos";
import { loadAll } from "@/lib/db/sqlite";
import type { ProjectSnapshot } from "@/lib/projects/tools";
import type { AgentContext, AgentSpec } from "@/lib/agents/types";
import type { Commit, RepoStatus } from "@/lib/git/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AGENT = "project-agent";

const DEFAULT_SERVICES =
  "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

// The pre-runtime route capped this surface at 2048 output tokens.
// runAgent defaults to 4096 (Brain's budget) — passing this explicitly keeps
// this surface's per-call cost and output ceiling unchanged; a truncated
// turn is now surfaced by stoppedBy/stopNotice rather than silently cut.
const MAX_TOKENS = 2048;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: DEFAULT_MODEL });
}

interface ChatRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  projectId?: string;
  agentId?: string;
  context?: { businessName?: string; founderName?: string; services?: string };
}

/**
 * The project, its milestones and its tasks, read from the database on the
 * project id alone. The client used to send this whole object; it now names
 * only which project, so a crafted body can neither invent milestones nor aim
 * the git reads at an arbitrary repo on this Mac.
 */
async function loadProjectSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  const data = await loadAll();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    project: { ...project, repoPath: linkedRepoPathFor(projectId, data.projects) },
    milestones: data.milestones.filter((m) => m.projectId === projectId),
    tasks: data.tasks.filter((t) => t.linkKind === "project" && t.linkId === projectId),
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError("agent_unconfigured", 503);

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", 400);
  }

  if (!body.projectId) return apiError("missing_project", 400);
  if (!body.messages?.length) return apiError("missing_messages", 400);

  let spec: AgentSpec;
  try {
    spec = await getAgent(body.agentId ?? DEFAULT_AGENT);
  } catch (err) {
    // AgentNotFound means the id genuinely doesn't exist. Anything else — a
    // readdir failure, a malformed .md, a loadOverrides DB error — is a real
    // server failure and must not be relabeled "not found" with an empty
    // console. apiError only logs when passed a cause.
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  // project-agent declares only `delivery` today, so this resolves to
  // {false,false}/null without a DB read. Wired anyway so that granting
  // `email`/`calendar`/`drive` in the agent file is all it takes — rather
  // than reproducing the Brain's old defect, where the tools arrived and
  // every call answered "not connected".
  const [{ emailEnabled, calendarEnabled }, driveAccountId] = await Promise.all([
    resolveAvailability(spec),
    resolveDriveAccountId(spec),
  ]);

  let snapshot: ProjectSnapshot | null;
  try {
    snapshot = await loadProjectSnapshot(body.projectId);
  } catch (err) {
    // A whole-DB read failing is a server failure, not a tool failure: every
    // answer this turn would be about a project we cannot see.
    return apiError("agent_failed", 502, err);
  }
  if (!snapshot) return apiError("project_not_found", 404);

  // Best-effort, for the state block only. A missing or unreadable repo must
  // never fail the request — git is never load-bearing.
  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  const { repoPath } = snapshot.project;
  if (repoPath) {
    const { readStatus, readCommits } = await import("@/lib/git/repo");
    [repo, commits] = await Promise.all([
      readStatus(repoPath).catch(() => null),
      readCommits(repoPath, { limit: 30 }).catch(() => [] as Commit[]),
    ]);
  }

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || DEFAULT_SERVICES,
    // Read-side CRM context is not granted on this surface: no project agent
    // declares `crm`, so nothing here resolves against an AdvisorSnapshot.
    snapshot: null,
    projectSnapshot: snapshot,
    proposals: [],
    emailEnabled,
    calendarEnabled,
    driveAccountId,
  };

  const stateBlock = buildProjectStateBlock({
    project: snapshot.project,
    milestones: snapshot.milestones,
    tasks: snapshot.tasks,
    repo,
    commits,
    businessName: ctx.businessName,
    founderName: ctx.founderName,
    today: ctx.today,
  });

  try {
    const result = await runAgent({
      spec: { ...spec, body: `${renderBody(spec.body, ctx)}\n\n${stateBlock}` },
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
      ctx,
      client: new Anthropic({ apiKey }),
      maxTokens: MAX_TOKENS,
    });

    // Preserves the pre-runtime route's fallback: a turn that ends with a
    // queued write but no trailing summary text should still tell the
    // founder something was queued, not "I couldn't produce a response".
    const content =
      result.content ||
      (result.proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.");

    return NextResponse.json({ content, actions: result.proposals, stoppedBy: result.stoppedBy });
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }
}
