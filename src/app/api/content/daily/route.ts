import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { loadAll } from "@/lib/db/sqlite";
import { runDaily } from "@/lib/content/daily/run";
import { chooseBriefs } from "@/lib/content/daily/brief";
import { draftPost } from "@/lib/content/daily/draft";
import { revisePost } from "@/lib/content/daily/revise";
import { listPosts, recentPosts, savePosts, saveRun, latestRun } from "@/lib/content/daily/store";
import { todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The pipeline makes up to five sequential model calls.
export const maxDuration = 300;

/**
 * Either a valid cron secret or a signed-in session. This route is excluded
 * from the NextAuth middleware matcher so the cron is not redirected to
 * /login, which makes the check below the only gate — it must stay strict.
 */
async function authorised(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return Boolean(await auth());
}

export async function POST(req: Request) {
  if (!(await authorised(req))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  const force = await req
    .json()
    .then((b: { force?: boolean }) => Boolean(b?.force))
    .catch(() => false);

  const today = todayISO();

  // Idempotent: the cron may fire more than once, and a retry must not
  // silently replace posts the founder has already acted on.
  if (!force) {
    const existing = await listPosts(today);
    if (existing.length > 0) {
      return NextResponse.json({ posts: existing, run: await latestRun(today) });
    }
  }

  try {
    const data = await loadAll();
    const client = new Anthropic({ apiKey });

    const { run, posts } = await runDaily({
      data,
      today,
      client,
      chooseBriefs,
      draftPost,
      revisePost,
      loadRecentPosts: recentPosts,
      persist: async (p, r) => {
        await savePosts(p);
        await saveRun(r);
      },
    });

    return NextResponse.json({ posts, run });
  } catch (err) {
    // runDaily already persisted the failed run before rethrowing.
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
