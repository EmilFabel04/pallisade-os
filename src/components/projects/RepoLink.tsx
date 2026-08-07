"use client";

import { useState } from "react";
import { GitBranch, Check, X } from "lucide-react";
import type { Project } from "@/lib/types";
import { useStore } from "@/lib/store";
import { fetchRepoStatus } from "@/lib/git/gitClient";
import { parseRepoSlug, isRepoSlug } from "@/lib/git/slug";
import { Field, TextInput } from "@/components/ui/Field";

const MESSAGE: Record<string, string> = {
  not_found: "No folder at that path — or GitHub can't see that repo.",
  not_a_repo: "That folder isn't a git repository.",
  git_failed: "Couldn't run git — is it installed and on PATH?",
  no_token: "GITHUB_TOKEN isn't set on the server, so GitHub can't be read.",
  forbidden: "GitHub refused the token. It needs `repo` scope for a private repo.",
  github_failed: "Couldn't reach GitHub just now.",
};

export function RepoLink({ project }: { project: Project }) {
  const { update } = useStore();
  const [value, setValue] = useState(project.repoPath ?? project.repoSlug ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const check = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      update("projects", project.id, { repoPath: null, repoSlug: null });
      setResult({ ok: true, message: "Repo unlinked." });
      return;
    }

    // One box, two kinds of reference. A slug is stored as a slug; an absolute
    // path is stored as a path AND resolved to a slug, so the deployed app can
    // read the same repo without being linked a second time.
    const asSlug = isRepoSlug(trimmed) ? parseRepoSlug(trimmed) : null;
    const query = asSlug ? { repoSlug: asSlug } : { repoPath: trimmed };

    setChecking(true);
    const res = await fetchRepoStatus(query);

    if (!res.ok) {
      setChecking(false);
      setResult({ ok: false, message: MESSAGE[res.error] ?? "Couldn't read that repo." });
      return;
    }

    let slug = asSlug;
    if (!slug) {
      // Ask the server what `origin` points at. A repo with no origin, or one
      // hosted elsewhere, answers null — a normal state that must not fail the
      // link, it just means the deployed app won't be able to read this one.
      const detected = await fetch(
        `/api/git?action=origin&path=${encodeURIComponent(trimmed)}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: string | null } | null) => j?.data ?? null)
        .catch(() => null);
      slug = detected;
    }

    setChecking(false);
    update("projects", project.id, {
      repoPath: asSlug ? null : trimmed,
      repoSlug: slug,
    });

    const where = res.data.source === "github" ? "via GitHub" : "locally";
    setResult({
      ok: true,
      message:
        `Linked ${where} — on branch ${res.data.branch || "(detached)"}.` +
        (asSlug || slug ? "" : " No GitHub remote found, so this won't work on the deployed app."),
    });
  };

  return (
    <div className="space-y-2.5">
      <Field
        label="Repository"
        hint="An absolute path on this Mac, or owner/repo for GitHub. A path also records its GitHub remote, so the deployed app can read it too."
      >
        <TextInput
          value={value}
          onChange={(e) => { setValue(e.target.value); setResult(null); }}
          placeholder="/Users/you/code/project — or owner/repo"
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
      {project.repoSlug && (
        <p className="text-[0.72rem] text-[var(--color-dim)]">
          GitHub: {project.repoSlug}
          {project.repoPath ? ` · local: ${project.repoPath}` : ""}
        </p>
      )}
    </div>
  );
}
