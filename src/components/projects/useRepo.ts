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

export function useRepo(repoPath: string | null, limit = 50): RepoState {
  const [state, setState] = useState<RepoState>(IDLE);

  useEffect(() => {
    if (!repoPath) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ ...IDLE, loading: true });

    (async () => {
      const [s, c] = await Promise.all([
        fetchRepoStatus(repoPath),
        fetchCommits(repoPath, limit),
      ]);
      if (cancelled) return;

      // A failure on either call is reported once; the page still renders.
      const error = !s.ok ? s.error : !c.ok ? c.error : null;
      setState({
        status: s.ok ? s.data : null,
        commits: c.ok ? c.data : [],
        error,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath, limit]);

  return state;
}
