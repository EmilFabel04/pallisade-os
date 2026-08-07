import { NextResponse } from "next/server";
import { realpath } from "node:fs/promises";
import { apiError } from "@/lib/api/errors";
import { GitError, readCommits, readStatus, readOriginSlug } from "@/lib/git/repo";
import { readCommitsApi, readStatusApi } from "@/lib/git/github";
import {
  isLinkedRepoPath, isLinkedRepoSlug, linkedRepoPaths, pathMatchesAny,
} from "@/lib/git/linkedRepos";
import { isRepoSlug } from "@/lib/git/slug";
import { pickRepoRef } from "@/lib/git/source";
import { loadAll } from "@/lib/db/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  not_a_repo: 404,
  git_failed: 502,
  no_token: 503,
  forbidden: 403,
  github_failed: 502,
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

    // A GitHub reference is gated on the stored slugs, never the paths — and
    // it must be gated at least as tightly: GITHUB_TOKEN carries `repo` scope,
    // so an ungated slug would expose commit messages from every private repo
    // the token can reach, not merely the repos on this Mac.
    if (isRepoSlug(candidate)) return isLinkedRepoSlug(candidate, projects);

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

/**
 * The caller sends whatever the project has stored — a path, a slug, or both —
 * and the SERVER decides which is readable here.
 *
 * The decision cannot be made in the browser: it turns on process.env.VERCEL,
 * which is server-only, and exposing it as NEXT_PUBLIC_ would let a stale
 * bundle disagree with the runtime it is talking to. Sending both and choosing
 * here keeps one authority.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";
  const limit = Number(url.searchParams.get("limit")) || undefined;

  // `origin` resolves a local path to its GitHub slug so linking a repo here
  // records both references at once. Local-only by nature — there is no local
  // repo to inspect when deployed — and it returns null rather than an error
  // for a repo with no origin or one hosted elsewhere, which are normal.
  if (action === "origin") {
    const path = url.searchParams.get("path") ?? "";
    if (!path) return notFound();
    return NextResponse.json({ data: await readOriginSlug(path) });
  }

  const picked = pickRepoRef({
    repoPath: url.searchParams.get("path"),
    repoSlug: url.searchParams.get("slug"),
  });
  if (!picked) return notFound();
  const { kind, ref } = picked;

  // `status` stays open on purpose: RepoLink validates a reference with it
  // *before* storing it, so it cannot require the reference to already be
  // linked. Locally that gives up a branch name and three counts. For a slug
  // it also confirms the token can see that repo — acceptable only because
  // this app is single-user (AUTH_ALLOWED_EMAIL) and the sole caller is the
  // person who owns the token. Do not widen access without revisiting this.
  if (action === "log" && !(await isLogAllowed(ref))) return notFound();

  try {
    const data =
      action === "log"
        ? kind === "github"
          ? await readCommitsApi(ref, { limit })
          : await readCommits(ref, { limit })
        : kind === "github"
          ? await readStatusApi(ref)
          : await readStatus(ref);
    return NextResponse.json({ data });
  } catch (err) {
    // Never leak a stack trace or a raw fs error to the client — GitError.message
    // carries the full command line and stderr.
    const code = err instanceof GitError ? err.code : "git_failed";
    return apiError(code, STATUS_FOR[code] ?? 502, err);
  }
}
