/* ============================================================
   GitHub reader (server-only).

   The counterpart to repo.ts. That one shells out to `git` against a path on
   this Mac, which is unreadable once deployed: a Vercel function's filesystem
   holds only the build output, so /Users/... does not exist, the filesystem is
   ephemeral, and `git` is not in the runtime image. This reader answers the
   same two questions over api.github.com so a linked repo works in production.

   It is NOT a drop-in equal. There is no working tree on the other end — see
   readStatusApi — and commits carry no file list without an extra request per
   commit, which for a 50-commit feed is 50 round trips. Both gaps are made
   explicit rather than papered over.
   ============================================================ */

import { GitError } from "./repo";
import { parseRepoSlug } from "./slug";
import type { Commit, RepoStatus } from "./types";

const API = "https://api.github.com";
const TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 50;

interface ApiCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { date?: string } | null;
committer?: { date?: string } | null;
  } | null;
}

interface ApiRepo {
  default_branch?: string;
}

/**
 * A token is required even for a public repo here: the unauthenticated limit
 * is 60 requests/hour per IP, which a serverless function shares with every
 * other tenant on that address and so exhausts immediately. A private repo
 * additionally needs `repo` scope.
 */
function token(): string {
  const t = process.env.GITHUB_TOKEN?.trim();
  if (!t) throw new GitError("no_token", "GITHUB_TOKEN is not set");
  return t;
}

async function api<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token()}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "pallisade-os",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof GitError) throw err;
    throw new GitError("github_failed", (err as Error).message);
  }

  if (res.status === 404) {
    // A private repo the token cannot see is indistinguishable from one that
    // does not exist — GitHub returns 404 for both, deliberately. Say so,
    // because "not found" alone sends the founder looking for a typo when the
    // real cause is usually a token without `repo` scope.
    throw new GitError("not_found", "Repo not found, or the token cannot see it");
  }
  if (res.status === 401 || res.status === 403) {
    throw new GitError("forbidden", `GitHub refused the token (${res.status})`);
  }
  if (!res.ok) {
    throw new GitError("github_failed", `GitHub returned ${res.status}`);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new GitError("github_failed", (err as Error).message);
  }
}

function requireSlug(ref: string): string {
  const slug = parseRepoSlug(ref);
  if (!slug) throw new GitError("not_a_repo", "Not a GitHub owner/repo reference");
  return slug;
}

/**
 * The repo's default branch, with every working-tree count zeroed.
 *
 * Those zeros are not measurements. Nothing on the GitHub side has a working
 * tree, so staged/unstaged/untracked/ahead/behind have no remote equivalent;
 * `source: "github"` is what tells the UI these are unknown rather than clean.
 */
export async function readStatusApi(ref: string): Promise<RepoStatus> {
  const slug = requireSlug(ref);
  const repo = await api<ApiRepo>(`/repos/${slug}`);
  return {
    branch: repo.default_branch ?? "",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    source: "github",
  };
}

/**
 * Recent commits on the default branch.
 *
 * `files` is always empty: the list endpoint does not include it, and filling
 * it would cost one extra request per commit. Nothing depends on the contents
 * — milestoneProgress.ts matches on `subject` and `authorDate` only — and the
 * two places that read it (CommitFeed, projects/prompt.ts) show a count and
 * are written to omit it when empty.
 */
export async function readCommitsApi(
  ref: string,
  opts: { limit?: number; since?: string } = {},
): Promise<Commit[]> {
  const slug = requireSlug(ref);
  const params = new URLSearchParams({
    per_page: String(Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 100))),
  });
  if (opts.since) params.set("since", opts.since);

  const commits = await api<ApiCommit[]>(`/repos/${slug}/commits?${params}`);
  if (!Array.isArray(commits)) return [];

  return commits.map((c) => {
    const message = c.commit?.message ?? "";
    const newline = message.indexOf("\n");
    return {
      hash: c.sha ?? "",
      shortHash: (c.sha ?? "").slice(0, 7),
      // git's own split: subject is the first line, body is the rest.
      subject: newline === -1 ? message : message.slice(0, newline),
      body: newline === -1 ? "" : message.slice(newline + 1).trim(),
      authorDate: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
      files: [],
    };
  });
}
