import type { Commit, GitErrorCode, RepoStatus } from "./types";

export type GitResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GitErrorCode };

async function call<T>(params: Record<string, string>): Promise<GitResult<T>> {
  try {
    const res = await fetch(`/api/git?${new URLSearchParams(params)}`);
    const json = await res.json();
    if (!res.ok) return { ok: false, error: (json.error as GitErrorCode) ?? "git_failed" };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: "git_failed" };
  }
}

export const fetchRepoStatus = (path: string) =>
  call<RepoStatus>({ path, action: "status" });

export const fetchCommits = (path: string, limit = 50) =>
  call<Commit[]>({ path, action: "log", limit: String(limit) });
