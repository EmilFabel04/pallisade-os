import type { Milestone } from "@/lib/types";
import type { Commit } from "./types";

/** Escape a user-supplied scope so it cannot inject regex syntax. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a conventional-commit scope — `feat(gantt):`, `fix(gantt)!:` — or a
 * bracket scope — `[gantt]`. Deliberately NOT a bare substring: "docs: describe
 * the gantt" is about the milestone, not work on it.
 */
function scopeMatcher(scope: string): RegExp {
  const s = escapeRe(scope.trim());
  return new RegExp(`(\\(\\s*${s}\\s*\\)\\s*!?\\s*:)|(\\[\\s*${s}\\s*\\])`, "i");
}

/**
 * Commits attributable to each milestone.
 *
 * Rule 1 — when `commitScope` is set, match on the scope and ignore dates.
 * Rule 2 — otherwise match commits whose author date falls inside
 *          [startDate, endDate] inclusive. A milestone missing either date
 *          matches nothing.
 *
 * A commit may match several milestones; exclusivity is not enforced because
 * any tie-break would be a guess. Every milestone gets a map entry, empty or not.
 */
export function matchCommits(
  commits: Commit[],
  milestones: Milestone[],
): Map<string, Commit[]> {
  const out = new Map<string, Commit[]>();

  for (const m of milestones) {
    if (m.commitScope.trim()) {
      const re = scopeMatcher(m.commitScope);
      out.set(m.id, commits.filter((c) => re.test(c.subject)));
      continue;
    }

    if (!m.startDate || !m.endDate) {
      out.set(m.id, []);
      continue;
    }

    const { startDate: from, endDate: to } = m;
    out.set(
      m.id,
      commits.filter((c) => {
        const day = c.authorDate.slice(0, 10);
        return day >= from && day <= to;
      }),
    );
  }

  return out;
}
