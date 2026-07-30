"use client";

import { GitCommit } from "lucide-react";
import type { Commit } from "@/lib/git/types";
import { relativeDay } from "@/lib/utils";

export function CommitFeed({ commits, limit }: { commits: Commit[]; limit?: number }) {
  if (commits.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No commits found.</p>;

  const shown = limit ? commits.slice(0, limit) : commits;

  return (
    <ul className="space-y-1.5">
      {shown.map((c) => (
        <li
          key={c.hash}
          className="flex items-start gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2"
        >
          <GitCommit size={14} className="mt-0.5 shrink-0 text-[var(--color-dim)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.82rem] text-[var(--color-ink-soft)] truncate" title={c.subject}>
              {c.subject}
            </p>
            <p className="text-[0.72rem] text-[var(--color-dim)] tnum">
              {c.shortHash} · {relativeDay(c.authorDate.slice(0, 10))}
              {c.files.length > 0 && ` · ${c.files.length} file${c.files.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
