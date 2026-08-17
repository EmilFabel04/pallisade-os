import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import Anthropic from "@anthropic-ai/sdk";
import type { ProposedAction } from "@/lib/types";
import { buildProjectSystemPrompt } from "@/lib/projects/prompt";
import { PROJECT_TOOLS, resolveProjectTool, type ProjectSnapshot } from "@/lib/projects/tools";
import { readCommits, readStatus } from "@/lib/git/repo";
import { linkedRepoPathFor } from "@/lib/git/linkedRepos";
import { loadAll } from "@/lib/db/sqlite";
import type { Commit, RepoStatus } from "@/lib/git/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface ChatRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: ProjectSnapshot;
  context?: { businessName?: string; founderName?: string };
}

/** The repo actually on record for this project, or null. Never trusts the request. */
async function storedRepoPath(projectId: string): Promise<string | null> {
  try {
    const { projects } = await loadAll();
    return linkedRepoPathFor(projectId, projects);
  } catch {
    return null; // fail closed
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body.snapshot?.project) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });
  if (!body.messages?.length) return NextResponse.json({ error: "missing_messages" }, { status: 400 });

  // The snapshot is client-supplied, so its repoPath is a claim, not a fact.
  // Take the path from the database keyed on the project id instead: a crafted
  // snapshot then can't aim these git reads at an arbitrary repo on this Mac,
  // and the model can't relay a repo it was never linked to back in prose.
  // A db failure just means no repo context — git is never load-bearing.
  const repoPath = await storedRepoPath(body.snapshot.project.id);
  const snapshot: ProjectSnapshot = {
    ...body.snapshot,
    project: { ...body.snapshot.project, repoPath },
  };

  // Repo reads are best-effort — a missing repo must never fail the request.
  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  if (repoPath) {
    [repo, commits] = await Promise.all([
      readStatus(repoPath).catch(() => null),
      readCommits(repoPath, { limit: 30 }).catch(() => [] as Commit[]),
    ]);
  }

  const system = buildProjectSystemPrompt({
    project: snapshot.project,
    milestones: snapshot.milestones ?? [],
    tasks: snapshot.tasks ?? [],
    repo,
    commits,
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    today: new Date().toISOString().slice(0, 10),
  });

  const client = new Anthropic({ apiKey });
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role, content: m.content,
  }));

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools: PROJECT_TOOLS as unknown as Anthropic.Tool[],
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
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: await resolveProjectTool(
            tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals,
          ),
        })),
      );
      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      finalText = proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.";
    }

    return NextResponse.json({ content: finalText, actions: proposals });
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
