// Shared types for the git status/log parsers and the caller that shells out
// to git. Kept separate from parse.ts and repo.ts so client components can
// import these types without ever pulling in `node:child_process`.

export interface RepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorDate: string; // ISO 8601
  files: string[];
}

export type GitErrorCode = "not_found" | "not_a_repo" | "git_failed";
