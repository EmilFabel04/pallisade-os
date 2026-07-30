"use client";

import { useState } from "react";
import { GitBranch, Check, X } from "lucide-react";
import type { Project } from "@/lib/types";
import { useStore } from "@/lib/store";
import { fetchRepoStatus } from "@/lib/git/gitClient";
import { Field, TextInput } from "@/components/ui/Field";

const MESSAGE: Record<string, string> = {
  not_found: "No folder at that path.",
  not_a_repo: "That folder isn't a git repository.",
  git_failed: "Couldn't run git — is it installed and on PATH?",
};

export function RepoLink({ project }: { project: Project }) {
  const { update } = useStore();
  const [path, setPath] = useState(project.repoPath ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const check = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      update("projects", project.id, { repoPath: null });
      setResult({ ok: true, message: "Repo unlinked." });
      return;
    }

    setChecking(true);
    const res = await fetchRepoStatus(trimmed);
    setChecking(false);

    if (res.ok) {
      update("projects", project.id, { repoPath: trimmed });
      setResult({ ok: true, message: `Linked — on branch ${res.data.branch || "(detached)"}.` });
    } else {
      setResult({ ok: false, message: MESSAGE[res.error] ?? "Couldn't read that repo." });
    }
  };

  return (
    <div className="space-y-2.5">
      <Field label="Repository path" hint="An absolute folder path on this Mac, e.g. /Users/you/code/acme">
        <TextInput
          value={path}
          onChange={(e) => { setPath(e.target.value); setResult(null); }}
          placeholder="/Users/you/code/project"
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center gap-2.5">
        <button className="btn btn-sm" onClick={check} disabled={checking}>
          <GitBranch size={13} /> {checking ? "Checking…" : "Check & link"}
        </button>
        {result && (
          <span
            className={`inline-flex items-center gap-1.5 text-[0.76rem] ${
              result.ok ? "text-[var(--color-positive)]" : "text-[var(--color-accent-soft)]"
            }`}
          >
            {result.ok ? <Check size={13} /> : <X size={13} />} {result.message}
          </span>
        )}
      </div>
    </div>
  );
}
