"use client";

import { useEffect, useState } from "react";
import { fetchCommits, fetchRepoStatus } from "@/lib/git/gitClient";
import type { Commit, GitErrorCode, RepoStatus } from "@/lib/git/types";

export interface RepoState {
  status: RepoStatus | null;
  commits: Commit[];
  error: GitErrorCode | null;
  loading: boolean;
}

const IDLE: RepoState = { status: null, commits: [], error: null, loading: false };

/** Comfortably past the store's 450ms persist debounce plus a local write. */
const JUST_LINKED_RETRY_MS = 1000;

export function useRepo(repoPath: string | null, limit = 50): RepoState {
  const [state, setState] = useState<RepoState>(IDLE);

  useEffect(() => {
    if (!repoPath) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ ...IDLE, loading: true });

    (async () => {
      const [s, c] = await Promise.all([
        fetchRepoStatus(repoPath),
        fetchCommits(repoPath, limit),
      ]);
      if (cancelled) return;

      // A repo linked a second ago hasn't reached the server yet: the store
      // persists on a debounce, and /api/git serves `log` only for a repo it
      // finds stored on a project. status succeeding while log 404s is exactly
      // that window — the path is a real repo, the server just doesn't know
      // it's linked. Retry the log once before reporting a failure, so linking
      // doesn't flash "couldn't read the repo" at the moment it succeeds.
      let commits = c;
      if (s.ok && !c.ok && c.error === "not_found") {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, JUST_LINKED_RETRY_MS);
        });
        if (cancelled) return;
        commits = await fetchCommits(repoPath, limit);
        if (cancelled) return;
      }

      // A failure on either call is reported once; the page still renders.
      const error = !s.ok ? s.error : !commits.ok ? commits.error : null;
      setState({
        status: s.ok ? s.data : null,
        commits: commits.ok ? commits.data : [],
        error,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repoPath, limit]);

  return state;
}
