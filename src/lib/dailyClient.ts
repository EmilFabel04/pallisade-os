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
