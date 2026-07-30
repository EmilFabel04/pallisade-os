/* ============================================================
   Which repos is this app allowed to read?

   /api/git takes an absolute path, so without a gate `action=log`
   would hand out commit subjects, bodies, author dates and changed
   file paths for ANY repo on this Mac. The app only ever needs the
   repos a project has stored, so log reads are restricted to those.

   Pure string logic — no fs, no db. The route resolves symlinks
   (which needs fs) and feeds the results back into pathMatchesAny.
   ============================================================ */

import path from "node:path";
import type { Project } from "@/lib/types";

/**
 * Canonical form for comparison: trimmed, dot/duplicate segments collapsed,
 * no trailing separator. Blank in, blank out — and blank never matches.
 */
export function normalizeRepoPath(p: string | null | undefined): string {
  const trimmed = (p ?? "").trim();
  if (!trimmed) return "";

  const normalized = path.normalize(trimmed);
  if (normalized === path.sep) return normalized; // keep root

  return normalized.replace(/[\\/]+$/, "");
}

/** Every distinct repo path stored on a project, normalized. */
export function linkedRepoPaths(projects: Project[]): string[] {
  const seen = new Set<string>();
  for (const p of projects) {
    const normalized = normalizeRepoPath(p.repoPath);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

/**
 * Exact match against one of `paths`, after normalizing both sides.
 * Not prefix matching: a parent or child of a linked repo is not linked.
 */
export function pathMatchesAny(candidate: string, paths: string[]): boolean {
  const target = normalizeRepoPath(candidate);
  if (!target) return false;
  return paths.some((p) => normalizeRepoPath(p) === target);
}

/** True when some project has this exact path stored as its repo. */
export function isLinkedRepoPath(candidate: string, projects: Project[]): boolean {
  return pathMatchesAny(candidate, linkedRepoPaths(projects));
}

/**
 * The repo stored on one specific project, or null. Use this instead of a
 * client-supplied path: it reads whatever is actually on record for that id,
 * so a caller can neither point a project's git reads at an unlinked repo nor
 * borrow another project's.
 */
export function linkedRepoPathFor(projectId: string, projects: Project[]): string | null {
  if (!projectId) return null;
  const match = projects.find((p) => p.id === projectId);
  return normalizeRepoPath(match?.repoPath) || null;
}
