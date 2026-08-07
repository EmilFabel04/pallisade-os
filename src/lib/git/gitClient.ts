import type { Commit, GitErrorCode, RepoStatus } from "./types";

export type GitResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GitErrorCode };

/**
 * Both references are sent and the SERVER picks which one it can read — see
 * the note on GET in /api/git. The browser has no way to know whether it is
 * talking to local dev or a deployed function, so it must not try to choose.
 */
export interface RepoLinkRefs {
  repoPath?: string | null;
  repoSlug?: string | null;
}

function params(refs: RepoLinkRefs, extra: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams(extra);
  if (refs.repoPath?.trim()) p.set("path", refs.repoPath.trim());
  if (refs.repoSlug?.trim()) p.set("slug", refs.repoSlug.trim());
  return p;
}

async function call<T>(search: URLSearchParams): Promise<GitResult<T>> {
  try {
    const res = await fetch(`/api/git?${search}`);
    const json = await res.json();
    if (!res.ok) return { ok: false, error: (json.error as GitErrorCode) ?? "git_failed" };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: "git_failed" };
  }
}

export const fetchRepoStatus = (refs: RepoLinkRefs) =>
  call<RepoStatus>(params(refs, { action: "status" }));

export const fetchCommits = (refs: RepoLinkRefs, limit = 50) =>
  call<Commit[]>(params(refs, { action: "log", limit: String(limit) }));
