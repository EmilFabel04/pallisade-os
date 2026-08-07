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
  /**
   * Which reader produced this.
   *
   * Load-bearing for the UI, not decoration. There is no working tree on the
   * GitHub side — no staged, unstaged, untracked or ahead/behind exists to be
   * read — so those counts come back as 0. Zero from the local reader means
   * "clean"; zero from "github" means "unknown". Without this field the two
   * are indistinguishable and a dirty repo would render as clean.
   */
  source: "local" | "github";
}

export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorDate: string; // ISO 8601
  files: string[];
}

export type GitErrorCode =
  | "not_found"
  | "not_a_repo"
  | "git_failed"
  // GitHub-reader failures. Kept distinct from git_failed because the fix is
  // different for each: no_token and forbidden are configuration the founder
  // can act on, github_failed is not.
  | "no_token"
  | "forbidden"
  | "github_failed";
