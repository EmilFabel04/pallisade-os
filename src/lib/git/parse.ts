import type { Commit, RepoStatus } from "./types";

/** The parser is pure string work and has no idea which reader called it,
 *  so it never sets `source` — readStatus stamps that at the boundary. */
export type ParsedStatus = Omit<RepoStatus, "source">;

const EMPTY_STATUS: ParsedStatus = {
  branch: "", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
};

/**
 * Parses `git status --porcelain=v2 --branch`.
 *
 * Header lines start `# branch.*`. Entry lines: `1` ordinary change,
 * `2` rename/copy, `u` unmerged, `?` untracked, `!` ignored. For `1`/`2`
 * the second field is an XY pair — X is the index (staged) state and Y the
 * worktree (unstaged) state, `.` meaning unmodified. A file can be both
 * staged and unstaged at once (e.g. `MM`), so the two counts aren't
 * mutually exclusive. `branch.ab` is absent with no upstream, leaving
 * ahead/behind at zero. Pure string parsing — never shells out.
 */
export function parseStatus(stdout: string): ParsedStatus {
  const out: ParsedStatus = { ...EMPTY_STATUS };

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      out.branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    const kind = line[0];
    if (kind === "?") {
      out.untracked += 1;
    } else if (kind === "u") {
      // A conflicted file needs work in the worktree.
      out.unstaged += 1;
    } else if (kind === "1" || kind === "2") {
      const xy = line.split(" ")[1] ?? "..";
      if (xy[0] && xy[0] !== ".") out.staged += 1;
      if (xy[1] && xy[1] !== ".") out.unstaged += 1;
    }
    // "!" ignored entries are deliberately not counted.
  }

  return out;
}

/**
 * The exact `--format` `readCommits` must pass. Fields, in order:
 * full hash, short hash, author date (ISO), subject, body — each preceded by
 * a record separator for the commit and separated by unit separators. The
 * trailing %x1f closes the body so `--name-only` file paths that follow are
 * unambiguously outside the fields.
 */
export const LOG_FORMAT = "%x1e%H%x1f%h%x1f%aI%x1f%s%x1f%b%x1f";

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\x1e")
    .slice(1) // text before the first record separator is never a commit
    .map((record) => {
      const [hash, shortHash, authorDate, subject, body, filesBlob] = record.split("\x1f");
      return {
        hash: (hash ?? "").trim(),
        shortHash: (shortHash ?? "").trim(),
        authorDate: (authorDate ?? "").trim(),
        subject: subject ?? "",
        body: body ?? "",
        files: (filesBlob ?? "")
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
      };
    })
    .filter((c) => !!c.hash);
}
