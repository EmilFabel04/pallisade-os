/* ============================================================
   Local git reader (server-only).

   Shells out to the `git` binary against an absolute path on
   this machine. Must only be imported from server code — it
   uses node:child_process and node:fs.
   ============================================================ */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseLog, parseStatus, LOG_FORMAT } from "./parse";
import type { Commit, GitErrorCode, RepoStatus } from "./types";

const run = promisify(execFile);

/** Hard caps so a huge or pathological repo cannot hang the route. */
const TIMEOUT_MS = 5000;
const MAX_BUFFER = 4 * 1024 * 1024;
const DEFAULT_LIMIT = 50;

export class GitError extends Error {
  constructor(readonly code: GitErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GitError";
  }
}

/**
 * The gatekeeper every read goes through. The path must be absolute, exist,
 * be a directory, and contain a `.git` entry (a file for worktrees, a
 * directory otherwise).
 */
export async function resolveRepo(repoPath: string): Promise<string> {
  const p = (repoPath ?? "").trim();
  if (!p || !path.isAbsolute(p)) throw new GitError("not_found", "Path must be absolute");

  try {
    const s = await stat(p);
    if (!s.isDirectory()) throw new GitError("not_found", "Path is not a directory");
  } catch (err) {
    if (err instanceof GitError) throw err;
    throw new GitError("not_found", "Path does not exist");
  }

  try {
    await stat(path.join(p, ".git"));
  } catch {
    throw new GitError("not_a_repo", "No .git found at this path");
  }

  return p;
}

/** execFile — never exec — so a path with shell metacharacters is an argument. */
async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", repoPath, ...args], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    throw new GitError("git_failed", (err as Error).message);
  }
}

export async function readStatus(repoPath: string): Promise<RepoStatus> {
  const dir = await resolveRepo(repoPath);
  return parseStatus(await git(dir, ["status", "--porcelain=v2", "--branch"]));
}

export async function readCommits(
  repoPath: string,
  opts: { limit?: number; since?: string } = {},
): Promise<Commit[]> {
  const dir = await resolveRepo(repoPath);
  const args = [
    "log",
    `--max-count=${Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 200))}`,
    "--date=iso-strict",
    "--name-only",
    `--format=${LOG_FORMAT}`,
  ];
  if (opts.since) args.push(`--since=${opts.since}`);

  return parseLog(await git(dir, args));
}
