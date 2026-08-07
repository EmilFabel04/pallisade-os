/* ============================================================
   Which reader answers for a project — pure, no fs, no network.

   Local git is the richer of the two (working-tree state, per-commit file
   lists) but only exists on this Mac. The GitHub API works anywhere but has no
   working tree. So the choice is made by where the code is running, not by
   preference, and it is kept here rather than inline so it can be tested
   without an environment.
   ============================================================ */

import { parseRepoSlug } from "./slug";

export type RepoRef =
  | { kind: "local"; ref: string }
  | { kind: "github"; ref: string };

export interface RepoLinks {
  repoPath?: string | null;
  repoSlug?: string | null;
}

/**
 * True when this process cannot see the founder's filesystem.
 *
 * VERCEL is set to "1" in every Vercel runtime and build. Read through a
 * parameter everywhere below so tests never mutate process.env.
 */
export function isDeployed(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * The reference to read, or null when the project has nothing usable here.
 *
 * Deployed, a stored absolute path is not merely unhelpful — it is guaranteed
 * to fail, because that path does not exist in the function's filesystem. So
 * deployed never falls back to it: it uses the slug or reports nothing, which
 * lets the UI say "add owner/repo" instead of surfacing a bare "not found".
 *
 * Locally the path wins when present, because it is the only source that can
 * report uncommitted work — the thing you actually want while coding.
 */
export function pickRepoRef(links: RepoLinks, deployed = isDeployed()): RepoRef | null {
  const path = (links.repoPath ?? "").trim();
  const slug = parseRepoSlug(links.repoSlug);

  if (deployed) return slug ? { kind: "github", ref: slug } : null;
  if (path) return { kind: "local", ref: path };
  return slug ? { kind: "github", ref: slug } : null;
}
