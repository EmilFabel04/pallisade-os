import { NextResponse } from "next/server";
import { GitError, readCommits, readStatus } from "@/lib/git/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  not_a_repo: 404,
  git_failed: 502,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoPath = url.searchParams.get("path") ?? "";
  const action = url.searchParams.get("action") ?? "status";
  const limit = Number(url.searchParams.get("limit")) || undefined;

  if (!repoPath) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const data =
      action === "log"
        ? await readCommits(repoPath, { limit })
        : await readStatus(repoPath);
    return NextResponse.json({ data });
  } catch (err) {
    // Never leak a stack trace or a raw fs error to the client.
    const code = err instanceof GitError ? err.code : "git_failed";
    return NextResponse.json({ error: code }, { status: STATUS_FOR[code] ?? 502 });
  }
}
