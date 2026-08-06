import { PURGE_CONFIRMATION } from "@/lib/content/daily/types";
import type { ContentPost, ContentRun, KillReason } from "@/lib/content/daily/types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    // `detail` is only ever set for founder-actionable preconditions, where
    // the server authored the message itself — prefer it over the bare code.
    throw new Error(body.detail ?? body.error ?? `request_failed_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchToday(
  date: string,
): Promise<{ posts: ContentPost[]; run: ContentRun | null }> {
  return jsonOrThrow(await fetch(`/api/content/posts?date=${date}`, { cache: "no-store" }));
}

export async function patchPost(
  id: string,
  changes: { status?: ContentPost["status"]; killReason?: KillReason | null; editedBody?: string | null },
): Promise<ContentPost> {
  const { post } = await jsonOrThrow<{ post: ContentPost }>(
    await fetch(`/api/content/posts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    }),
  );
  return post;
}

/** Hard delete. Resolves on success; the caller drops the card. */
export async function deletePost(id: string): Promise<void> {
  await jsonOrThrow<{ deleted: string }>(
    await fetch(`/api/content/posts/${id}`, { method: "DELETE" }),
  );
}

/**
 * Every post on every date, plus the failed run records. Unrecoverable.
 * The confirmation string is required by the route so a bare DELETE at the
 * collection URL cannot empty the table.
 */
export async function deleteAllPosts(): Promise<{ deletedPosts: number; deletedRuns: number }> {
  return jsonOrThrow(
    await fetch("/api/content/posts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: PURGE_CONFIRMATION }),
    }),
  );
}

export async function runDailyNow(
  force = false,
): Promise<{ posts: ContentPost[]; run: ContentRun }> {
  return jsonOrThrow(
    await fetch("/api/content/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    }),
  );
}
