import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { listPosts, latestRun, deleteAllPosts, deleteFailedRuns } from "@/lib/content/daily/store";
import { PURGE_CONFIRMATION } from "@/lib/content/daily/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  try {
    const [posts, run] = await Promise.all([listPosts(date), latestRun(date)]);
    return NextResponse.json({ posts, run });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}

/**
 * Delete every post on every date, plus the failed run records.
 *
 * Successful runs are kept — they are the record of what the engine actually
 * produced. Failed ones go because TodayPanel renders their stored error as a
 * live banner and its auto-generate effect bails while one exists.
 *
 * Two guards, because this is unrecoverable and there is no tombstone:
 *
 *   1. An explicit session check. The NextAuth middleware already fronts this
 *      path, but its matcher is a single hand-written negative-lookahead
 *      literal that has regressed before, and an unauthenticated wipe of every
 *      post is the worst thing that regression could expose. The cost of the
 *      redundancy is one call.
 *   2. A confirmation string in the body, so a bare `DELETE /api/content/posts`
 *      — a mistyped URL, a client retrying the collection endpoint — cannot
 *      empty the table.
 */
export async function DELETE(req: Request) {
  if (!(await auth())) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const confirm = await req
    .json()
    .then((b: { confirm?: string }) => b?.confirm)
    .catch(() => undefined);

  if (confirm !== PURGE_CONFIRMATION) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  try {
    // Posts first: if the run delete fails, the caller retries and the
    // already-empty post table makes that retry a no-op rather than a
    // partial second wipe.
    const posts = await deleteAllPosts();
    const runs = await deleteFailedRuns();
    return NextResponse.json({ deletedPosts: posts, deletedRuns: runs });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
