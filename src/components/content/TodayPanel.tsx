"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { fetchToday, runDailyNow, deleteAllPosts } from "@/lib/dailyClient";
import { todayISO } from "@/lib/utils";
import PostCard from "./PostCard";
import type { ContentPost, ContentRun } from "@/lib/content/daily/types";

export default function TodayPanel() {
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [run, setRun] = useState<ContentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoTried, setAutoTried] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purged, setPurged] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchToday(todayISO());
      setPosts(data.posts);
      setRun(data.run);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await runDailyNow(true);
      setPosts(data.posts);
      setRun(data.run);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, []);

  // The cron may not have run — a paused deployment, a missed schedule. If it
  // is past 06:00 and today has neither a run nor posts, kick one off once.
  // The autoTried guard survives Strict Mode's double-invoke.
  useEffect(() => {
    if (loading || autoTried || generating) return;
    if (run || posts.length > 0) return;
    if (new Date().getHours() < 6) return;
    setAutoTried(true);
    void generate();
  }, [loading, autoTried, generating, run, posts.length, generate]);

  const replace = (updated: ContentPost) =>
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  const drop = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  /**
   * Wipes every post on every date and the failed run records.
   *
   * `setRun(null)` afterwards is load-bearing rather than cosmetic: the stale
   * "Generation failed" banner reads `run.status`, and the auto-generate
   * effect above bails while `run` is non-null. Clearing it locally puts the
   * panel in the same state a fresh load would, so the next generate is
   * reachable without a refresh.
   */
  const purge = useCallback(async () => {
    setPurging(true);
    setError(null);
    try {
      const { deletedPosts, deletedRuns } = await deleteAllPosts();
      setPosts([]);
      setRun(null);
      setAutoTried(true); // don't let the effect immediately regenerate
      setConfirmPurge(false);
      setPurged(`Deleted ${deletedPosts} post${deletedPosts === 1 ? "" : "s"} and ${deletedRuns} failed run${deletedRuns === 1 ? "" : "s"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPurging(false);
    }
  }, []);

  return (
    <Panel title="Today">
      {loading && (
        <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && run?.status === "failed" && (
        <p className="text-[0.8rem] text-[var(--color-accent)]">
          {/* The timestamp matters: this is a STORED record of the last run,
              not a live result, and without a time a failure from hours ago
              reads as one that just happened. */}
          Generation failed
          {run.finishedAt || run.startedAt
            ? ` at ${new Date(run.finishedAt ?? run.startedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : ""}
          : {run.error}
        </p>
      )}

      {!loading && run?.status === "thin" && run.degraded.length > 0 && (
        <p className="text-[0.78rem] text-[var(--color-muted)] mb-3">{run.degraded[0]}</p>
      )}

      {!loading && posts.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[0.83rem] text-[var(--color-muted)]">
            No posts for today yet.
          </p>
          <button className="btn btn-accent btn-sm" onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate today&apos;s posts
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} onChange={replace} onDelete={drop} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-4">
        {!loading && posts.length > 0 && (
          <button className="btn btn-sm" onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Regenerate both
          </button>
        )}

        {!loading && confirmPurge ? (
          <>
            <button
              className="btn btn-accent btn-sm"
              onClick={() => void purge()}
              disabled={purging}
              title="Deletes every post on every date. This cannot be undone."
            >
              {purging ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete every post, permanently
            </button>
            <button className="btn btn-sm" onClick={() => setConfirmPurge(false)} disabled={purging}>
              Cancel
            </button>
          </>
        ) : (
          !loading && (
            <button
              className="btn btn-sm"
              onClick={() => { setConfirmPurge(true); setPurged(null); }}
              title="Delete all generated posts across every date"
            >
              <Trash2 size={13} /> Delete all posts
            </button>
          )
        )}
      </div>

      {purged && <p className="text-[0.78rem] text-[var(--color-muted)] mt-2">{purged}</p>}

      {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}
    </Panel>
  );
}
