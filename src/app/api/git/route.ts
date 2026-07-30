import { NextResponse } from "next/server";
import { realpath } from "node:fs/promises";
import { GitError, readCommits, readStatus } from "@/lib/git/repo";
import { isLinkedRepoPath, linkedRepoPaths, pathMatchesAny } from "@/lib/git/linkedRepos";
import { loadAll } from "@/lib/db/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  not_a_repo: 404,
  git_failed: 502,
};

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * `log` is served only for a repo some project has linked — it returns commit
 * subjects, bodies, author dates and changed file paths, which we have no
 * reason to hand out for any other repo on this Mac.
 *
 * Unlinked, missing and unreadable all answer the same 404 as a bad path, so
 * the response can't be used to probe the filesystem.
 */
async function isLogAllowed(candidate: string): Promise<boolean> {
  try {
    const { projects } = await loadAll();
    if (isLinkedRepoPath(candidate, projects)) return true;

    // Second pass through realpath, so a linked repo reached by a symlink
    // (either side) still resolves to the same repo instead of silently
    // dropping off the commit feed.
    const [real, linked] = await Promise.all([
      realpath(candidate),
      Promise.all(linkedRepoPaths(projects).map((p) => realpath(p).catch(() => ""))),
    ]);
    return pathMatchesAny(real, linked);
  } catch {
    return false; // fail closed: a db or fs error must not open the gate
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoPath = url.searchParams.get("path") ?? "";
  const action = url.searchParams.get("action") ?? "status";
  const limit = Number(url.searchParams.get("limit")) || undefined;

  if (!repoPath) return notFound();

  // `status` stays open on purpose: RepoLink validates a path with it *before*
  // storing it, so it cannot require the path to already be linked. It gives up
  // only a branch name and three counts.
  if (action === "log" && !(await isLogAllowed(repoPath))) return notFound();

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
