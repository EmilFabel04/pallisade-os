"use client";

import { useState } from "react";
import { Copy, Check, Pencil, ThumbsUp, X, Trash2 } from "lucide-react";
import Link from "next/link";
import { useStore, useVoiceProfile } from "@/lib/store";
import { patchPost, deletePost } from "@/lib/dailyClient";
import { PILLAR_META, FORMAT_META } from "@/lib/content/daily/craft";
import { KILL_REASONS, type ContentPost, type KillReason } from "@/lib/content/daily/types";

/** Verified against src/app — omit the link for anything not listed. */
const SOURCE_ROUTES: Record<string, string> = {
  painPoints: "/pain-bank",
  leads: "/leads",
  interactions: "/interactions",
  projects: "/projects",
  milestones: "/projects",
  scorecards: "/scorecard",
  notes: "/notebook",
};

const KILL_LABELS: Record<KillReason, string> = {
  boring: "Boring",
  not_my_voice: "Not my voice",
  not_true: "Not true",
  wrong_angle: "Wrong angle",
  already_said: "Already said it",
};

export default function PostCard({
  post,
  onChange,
  onDelete,
}: {
  post: ContentPost;
  onChange: (p: ContentPost) => void;
  /** Called once the row is gone, so the parent can drop the card. */
  onDelete: (id: string) => void;
}) {
  const store = useStore();
  const profile = useVoiceProfile();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.editedBody ?? post.body);
  const [copied, setCopied] = useState(false);
  const [killing, setKilling] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [showPhrase, setShowPhrase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = post.editedBody ?? post.body;
  const failures = post.checks.filter((c) => !c.passed);

  const apply = async (changes: Parameters<typeof patchPost>[1]) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await patchPost(post.id, changes));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setEditing(false);
    await apply({ editedBody: draft });
  };

  // Deliberately does NOT clear `busy` on success: the card is about to be
  // unmounted by the parent, and setting state on the way out would warn.
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deletePost(post.id);
      onDelete(post.id);
    } catch (e) {
      setError((e as Error).message);
      setConfirmDelete(false);
      setBusy(false);
    }
  };

  const kill = async (reason: KillReason) => {
    if (reason === "not_my_voice") setShowPhrase(true);
    else setKilling(false);
    await apply({ status: "killed", killReason: reason });
  };

  // A reason chip alone cannot identify an offending phrase, so this is the
  // only path by which neverSay grows from a kill.
  const addPhrase = () => {
    const value = phrase.trim().toLowerCase();
    if (!value || !profile) return;
    const next = [...new Set([...profile.neverSay, value])].slice(-60);
    store.update("voiceProfile", profile.id, { neverSay: next });
    setPhrase("");
    setShowPhrase(false);
    setKilling(false);
  };

  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{
        border: "1px solid var(--color-line)",
        borderRadius: 10,
        background: "var(--color-surface-2)",
        opacity: post.status === "killed" ? 0.5 : 1,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem]">
        <span className="chip">{PILLAR_META[post.pillar].label}</span>
        <span className="chip">{FORMAT_META[post.format].label}</span>
        {post.status === "needs_work" && (
          <span className="text-[var(--color-accent)]">needs work</span>
        )}
        {post.status === "kept" && <span className="text-[var(--color-dim)]">kept</span>}
        {post.revisions > 0 && (
          <span className="text-[var(--color-dim)]">
            {post.revisions} revision{post.revisions === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {editing ? (
        <textarea
          className="textarea"
          rows={12}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-[0.85rem] leading-relaxed text-[var(--color-ink)]">
          {shown}
        </pre>
      )}

      <div className="text-[0.72rem] text-[var(--color-dim)]">
        {post.sourceRefs.map((ref, i) => {
          const href = SOURCE_ROUTES[ref.collection];
          return (
            <span key={`${ref.collection}-${ref.id}-${i}`}>
              {i > 0 && " · "}
              From{" "}
              {href ? (
                <Link href={href} className="underline">
                  {ref.collection}
                </Link>
              ) : (
                ref.collection
              )}{" "}
              — &ldquo;{ref.anchor}&rdquo;
            </span>
          );
        })}
      </div>

      {failures.length > 0 && (
        <div className="flex flex-col gap-0.5 text-[0.72rem] text-[var(--color-accent)]">
          {failures.map((c) => (
            <div key={c.rule}>
              {c.rule} — {c.detail}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm" onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        {editing ? (
          <button className="btn btn-accent btn-sm" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={12} /> Edit
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => void apply({ status: "kept" })}
          disabled={busy}
        >
          <ThumbsUp size={12} /> Keep
        </button>
        <button className="btn btn-sm" onClick={() => setKilling((k) => !k)}>
          <X size={12} /> Kill
        </button>
        {confirmDelete ? (
          <>
            <button
              className="btn btn-accent btn-sm"
              onClick={() => void remove()}
              disabled={busy}
              title="This cannot be undone"
            >
              <Trash2 size={12} /> Delete for good
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            title="Remove this post permanently"
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>

      {killing && (
        <div className="flex flex-wrap gap-1.5">
          {KILL_REASONS.map((r) => (
            <button key={r} className="btn btn-sm" onClick={() => void kill(r)} disabled={busy}>
              {KILL_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {showPhrase && (
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Which bit sounded wrong? (optional)"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPhrase()}
          />
          <button className="btn btn-sm" onClick={addPhrase} disabled={!phrase.trim() || !profile}>
            Add
          </button>
        </div>
      )}

      {error && <p className="text-[0.72rem] text-[var(--color-accent)]">{error}</p>}
    </div>
  );
}
